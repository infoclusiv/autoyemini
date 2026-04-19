(function registerChatGPTRemoteBridge() {
  const bridgeConfig = CONFIG?.REMOTE_BRIDGE || {};
  const BRIDGE_URL = bridgeConfig.BRIDGE_URL || "ws://localhost:8767";
  const EXTENSION_ID = bridgeConfig.EXTENSION_ID || "autoyemini";
  const EXTENSION_TYPE = bridgeConfig.EXTENSION_TYPE || "ai-studio-workflow";
  const PERIODIC_ALARM = "chatgpt-remote-bridge-alarm";
  const RETRY_ALARM = "chatgpt-remote-bridge-retry";
  const REQUEST_TIMEOUT_MS = 10000;
  const RECONNECT_DELAY_MS = 5000;
  const CONNECT_TIMEOUT_MS = 8000;

  let socket = null;
  let connectInProgress = false;
  let reconnectTimer = null;
  let connectTimeoutId = null;
  let lastConnectReason = "idle";
  let lastConnectionAttemptAt = 0;
  const pendingRequests = new Map();

  function logBridge(level, message, details) {
    const prefix = `[RemoteBridge:${EXTENSION_ID}] ${message}`;
    const logger = console[level] || console.log;
    if (details === undefined) {
      logger.call(console, prefix);
      return;
    }
    logger.call(console, prefix, details);
  }

  function describeReadyState(target = socket) {
    if (!target) {
      return "NO_SOCKET";
    }

    switch (target.readyState) {
      case WebSocket.CONNECTING:
        return "CONNECTING";
      case WebSocket.OPEN:
        return "OPEN";
      case WebSocket.CLOSING:
        return "CLOSING";
      case WebSocket.CLOSED:
        return "CLOSED";
      default:
        return `UNKNOWN(${target.readyState})`;
    }
  }

  function summarizePayload(payload) {
    if (!payload || typeof payload !== "object") {
      return { payloadType: typeof payload };
    }

    const summary = {};
    ["action", "requestId", "replyTo", "workflowId", "workflowName", "status", "reason"].forEach((key) => {
      const value = payload[key];
      if (value !== undefined && value !== null && value !== "") {
        summary[key] = value;
      }
    });
    return summary;
  }

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function clearConnectTimeout() {
    if (connectTimeoutId) {
      clearTimeout(connectTimeoutId);
      connectTimeoutId = null;
    }
  }

  function clearRetryAlarm() {
    if (!chrome.alarms) {
      return;
    }
    try {
      void chrome.alarms.clear(RETRY_ALARM);
    } catch {
    }
  }

  function isSocketOpen() {
    return socket && socket.readyState === WebSocket.OPEN;
  }

  function rejectPendingRequests(errorMessage) {
    const error = new Error(errorMessage || "El bridge remoto de ChatGPT se desconectó.");
    pendingRequests.forEach((entry) => {
      if (entry?.timeoutId) {
        clearTimeout(entry.timeoutId);
      }
      try {
        entry.reject(error);
      } catch {
      }
    });
    pendingRequests.clear();
  }

  function removePendingRequest(requestId) {
    const entry = pendingRequests.get(requestId);
    if (entry?.timeoutId) {
      clearTimeout(entry.timeoutId);
    }
    pendingRequests.delete(requestId);
  }

  function resolvePendingRequest(data) {
    const requestId = data?.replyTo || data?.requestId;
    if (!requestId || !pendingRequests.has(requestId)) {
      return false;
    }

    const entry = pendingRequests.get(requestId);
    removePendingRequest(requestId);
    entry.resolve(data);
    return true;
  }

  function sendRaw(payload, targetSocket = socket) {
    if (!(targetSocket && targetSocket.readyState === WebSocket.OPEN)) {
      logBridge("warn", "Skipped sendRaw because socket is not open.", {
        payload: summarizePayload(payload),
        readyState: describeReadyState(targetSocket)
      });
      return false;
    }

    try {
      targetSocket.send(JSON.stringify(payload));
      logBridge("debug", "Sent bridge payload.", summarizePayload(payload));
      return true;
    } catch (error) {
      logBridge("error", "Failed to send bridge payload.", {
        error: error.message,
        payload: summarizePayload(payload),
        readyState: describeReadyState(targetSocket)
      });
      return false;
    }
  }

  function sendRequest(payload, timeoutMs = REQUEST_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const requestId = payload.requestId || `bridge_${Date.now()}_${SharedUtils.generateUUID()}`;
      const message = { ...payload, requestId };

      if (!sendRaw(message)) {
        reject(new Error("El bridge remoto de ChatGPT no está conectado."));
        return;
      }

      const timeoutId = setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error("Timeout esperando respuesta del bridge remoto."));
      }, timeoutMs);

      pendingRequests.set(requestId, { resolve, reject, timeoutId });
    });
  }

  async function handleListWorkflowsRequest(message) {
    try {
      const workflows = await globalThis.ChatGPTRemoteRuntime.listWorkflows();
      sendRaw({
        action: "WORKFLOWS_LIST",
        replyTo: message.requestId,
        workflows,
        message: `${workflows.length} workflow(s) disponibles.`
      });
    } catch (error) {
      sendRaw({
        action: "WORKFLOWS_LIST",
        replyTo: message.requestId,
        workflows: [],
        message: error.message || "No se pudieron cargar los workflows remotos."
      });
    }
  }

  async function handleRunWorkflowRequest(message) {
    try {
      const result = await globalThis.ChatGPTRemoteRuntime.runWorkflow(message.workflowId);
      sendRaw({
        action: "WORKFLOW_RUN_ACK",
        replyTo: message.requestId,
        ok: result.ok === true,
        status: result.status || (result.ok ? "queued" : "error"),
        message: result.message || "Solicitud remota procesada.",
        workflowId: result.workflowId || message.workflowId || "",
        workflowName: result.workflowName || message.workflowName || "",
        stepIndex: typeof result.stepIndex === "number" ? result.stepIndex : -1
      });
    } catch (error) {
      sendRaw({
        action: "WORKFLOW_RUN_ACK",
        replyTo: message.requestId,
        ok: false,
        status: "error",
        message: error.message || "Falló la ejecución remota del workflow.",
        workflowId: message.workflowId || "",
        workflowName: message.workflowName || "",
        stepIndex: -1
      });
    }
  }

  async function handleBridgeMessage(event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      logBridge("error", "Failed to parse bridge payload.", {
        error: error.message,
        raw: String(event.data || "").slice(0, 400)
      });
      return;
    }

    logBridge("debug", "Received bridge payload.", summarizePayload(message));

    if (resolvePendingRequest(message)) {
      return;
    }

    switch (message.action) {
      case "PING": {
        const sent = sendRaw({
          action: "PONG",
          replyTo: message.requestId,
          version: CONFIG.APP_VERSION,
          extensionId: EXTENSION_ID,
          extensionType: EXTENSION_TYPE,
          instanceId: "default"
        });
        if (!sent) {
          logBridge("error", "Failed to respond to PING.", summarizePayload(message));
        }
        break;
      }
      case "LIST_WORKFLOWS":
        await handleListWorkflowsRequest(message);
        break;
      case "RUN_WORKFLOW":
        await handleRunWorkflowRequest(message);
        break;
      default:
        logBridge("warn", "Unhandled bridge action.", summarizePayload(message));
        break;
    }
  }

  function finalizeSocketLoss(targetSocket, errorMessage) {
    clearConnectTimeout();
    connectInProgress = false;

    if (socket !== targetSocket) {
      return false;
    }

    socket = null;
    rejectPendingRequests(errorMessage);
    return true;
  }

  function scheduleReconnect(reason = "retry-timer") {
    lastConnectReason = reason || lastConnectReason;
    clearReconnectTimer();
    clearRetryAlarm();

    logBridge("warn", "Scheduling reconnect.", {
      reason,
      delayMs: RECONNECT_DELAY_MS,
      readyState: describeReadyState()
    });

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void ensureConnected(reason);
    }, RECONNECT_DELAY_MS);

    if (chrome.alarms) {
      try {
        // Alarms survive MV3 service worker suspension better than in-memory timers.
        chrome.alarms.create(RETRY_ALARM, { when: Date.now() + RECONNECT_DELAY_MS });
      } catch (error) {
        logBridge("warn", "Failed to schedule retry alarm.", { reason, error: error.message });
      }
    }
  }

  function beginConnectTimeout(targetSocket, reason) {
    clearConnectTimeout();
    connectTimeoutId = setTimeout(() => {
      if (socket !== targetSocket || targetSocket.readyState === WebSocket.OPEN) {
        return;
      }

      logBridge("error", "WebSocket connect timeout.", {
        reason,
        readyState: describeReadyState(targetSocket),
        timeoutMs: CONNECT_TIMEOUT_MS
      });

      finalizeSocketLoss(targetSocket, `Timeout de conexión hacia ${BRIDGE_URL}.`);
      try {
        targetSocket.close();
      } catch {
      }
      scheduleReconnect("connect-timeout");
    }, CONNECT_TIMEOUT_MS);
  }

  async function ensureConnected(reason = "manual") {
    lastConnectReason = reason;

    if (isSocketOpen()) {
      logBridge("debug", "Skipping connect because socket is already open.", {
        reason,
        readyState: describeReadyState()
      });
      return true;
    }

    if (connectInProgress) {
      logBridge("debug", "Skipping connect because another attempt is in progress.", {
        reason,
        readyState: describeReadyState()
      });
      return true;
    }

    connectInProgress = true;
    lastConnectionAttemptAt = Date.now();
    clearReconnectTimer();
    clearRetryAlarm();

    try {
      const targetSocket = new WebSocket(BRIDGE_URL);
      socket = targetSocket;

      logBridge("info", "Opening websocket.", { reason, url: BRIDGE_URL });
      beginConnectTimeout(targetSocket, reason);

      targetSocket.addEventListener("open", () => {
        if (socket !== targetSocket) {
          return;
        }

        clearConnectTimeout();
        connectInProgress = false;

        logBridge("info", "WebSocket open.", {
          reason,
          readyState: describeReadyState(targetSocket),
          elapsedMs: Date.now() - lastConnectionAttemptAt
        });

        const sent = sendRaw({
          action: "EXTENSION_CONNECTED",
          version: CONFIG.APP_VERSION,
          extensionId: EXTENSION_ID,
          extensionType: EXTENSION_TYPE,
          instanceId: "default",
          reason
        }, targetSocket);

        logBridge(sent ? "info" : "error", "EXTENSION_CONNECTED dispatch.", {
          reason,
          sent
        });

        if (!sent) {
          const lostActiveSocket = finalizeSocketLoss(targetSocket, "No se pudo enviar EXTENSION_CONNECTED.");
          try {
            targetSocket.close();
          } catch {
          }
          if (lostActiveSocket) {
            scheduleReconnect("extension-connected-send-failed");
          }
        }
      });

      targetSocket.addEventListener("message", (event) => {
        if (socket !== targetSocket) {
          logBridge("warn", "Ignoring bridge message from stale socket.", {
            readyState: describeReadyState(targetSocket)
          });
          return;
        }

        void handleBridgeMessage(event).catch((error) => {
          logBridge("error", "Bridge message handler failed.", { error: error.message });
        });
      });

      targetSocket.addEventListener("close", (event) => {
        const lostActiveSocket = finalizeSocketLoss(targetSocket, `Socket cerrado (${event.code}).`);
        logBridge("warn", "WebSocket close.", {
          code: event.code,
          reason: event.reason || "",
          wasClean: event.wasClean,
          readyState: describeReadyState(targetSocket),
          activeSocket: lostActiveSocket
        });

        if (lostActiveSocket) {
          scheduleReconnect("close");
        }
      });

      targetSocket.addEventListener("error", () => {
        const lostActiveSocket = finalizeSocketLoss(targetSocket, `Error de conexión hacia ${BRIDGE_URL}.`);
        logBridge("error", "WebSocket error.", {
          reason,
          readyState: describeReadyState(targetSocket),
          activeSocket: lostActiveSocket
        });

        try {
          if (targetSocket.readyState === WebSocket.CONNECTING || targetSocket.readyState === WebSocket.OPEN) {
            targetSocket.close();
          }
        } catch {
        }

        if (lostActiveSocket) {
          scheduleReconnect("error");
        }
      });

      return true;
    } catch (error) {
      clearConnectTimeout();
      connectInProgress = false;
      socket = null;
      logBridge("error", "Failed to create WebSocket.", {
        reason,
        url: BRIDGE_URL,
        error: error.message
      });
      scheduleReconnect("constructor-error");
      return false;
    }
  }

  function notifyWorkflowStatus(payload) {
    const sent = sendRaw({
      action: "WORKFLOW_STATUS",
      workflowId: payload.workflowId || "",
      workflowName: payload.workflowName || "",
      stepIndex: typeof payload.stepIndex === "number" ? payload.stepIndex : -1,
      running: payload.running === true,
      status: payload.status || "idle",
      message: payload.message || "Estado remoto actualizado."
    });

    if (!sent) {
      logBridge("warn", "Failed to publish WORKFLOW_STATUS.", summarizePayload(payload));
    }
  }

  function registerBridgeLifecycle() {
    logBridge("info", "Registering bridge lifecycle.");

    if (chrome.alarms) {
      chrome.alarms.create(PERIODIC_ALARM, { periodInMinutes: 0.5 });
      chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === PERIODIC_ALARM) {
          void ensureConnected("alarm");
          return;
        }

        if (alarm.name === RETRY_ALARM) {
          void ensureConnected("retry-alarm");
        }
      });
    }

    chrome.runtime.onStartup.addListener(() => {
      logBridge("info", "runtime.onStartup received.");
      void ensureConnected("startup");
    });

    chrome.runtime.onInstalled.addListener(() => {
      logBridge("info", "runtime.onInstalled received.");
      void ensureConnected("installed");
    });
  }

  function getDebugState() {
    return {
      bridgeUrl: BRIDGE_URL,
      connectInProgress,
      readyState: describeReadyState(),
      lastConnectReason,
      lastConnectionAttemptAt,
      pendingRequests: pendingRequests.size
    };
  }

  globalThis.ChatGPTRemoteBridge = {
    ensureConnected,
    notifyWorkflowStatus,
    sendRequest,
    registerBridgeLifecycle,
    getDebugState
  };
})();