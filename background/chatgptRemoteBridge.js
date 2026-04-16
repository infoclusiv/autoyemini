(function registerChatGPTRemoteBridge() {
  const BRIDGE_URL = "ws://localhost:8766";
  const RECONNECT_ALARM = "chatgpt-remote-bridge-alarm";
  const REQUEST_TIMEOUT_MS = 10000;

  let socket = null;
  let connectInProgress = false;
  let reconnectTimer = null;
  const pendingRequests = new Map();

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function isSocketOpen() {
    return socket && socket.readyState === WebSocket.OPEN;
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

  function sendRaw(payload) {
    if (!isSocketOpen()) {
      return false;
    }

    try {
      socket.send(JSON.stringify(payload));
      return true;
    } catch {
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
    } catch {
      return;
    }

    if (resolvePendingRequest(message)) {
      return;
    }

    switch (message.action) {
      case "PING":
        sendRaw({
          action: "PONG",
          replyTo: message.requestId,
          version: CONFIG.APP_VERSION,
          extensionType: "chatgpt-workflow"
        });
        break;
      case "LIST_WORKFLOWS":
        await handleListWorkflowsRequest(message);
        break;
      case "RUN_WORKFLOW":
        await handleRunWorkflowRequest(message);
        break;
      default:
        break;
    }
  }

  function scheduleReconnect() {
    clearReconnectTimer();
    reconnectTimer = setTimeout(() => {
      void ensureConnected("retry-timer");
    }, 5000);
  }

  async function ensureConnected(reason = "manual") {
    if (isSocketOpen() || connectInProgress) {
      return true;
    }

    connectInProgress = true;
    clearReconnectTimer();

    try {
      socket = new WebSocket(BRIDGE_URL);
      socket.addEventListener("open", () => {
        connectInProgress = false;
        sendRaw({
          action: "EXTENSION_CONNECTED",
          version: CONFIG.APP_VERSION,
          extensionType: "chatgpt-workflow",
          instanceId: "default",
          reason
        });
      });
      socket.addEventListener("message", (event) => {
        void handleBridgeMessage(event);
      });
      socket.addEventListener("close", () => {
        connectInProgress = false;
        socket = null;
        scheduleReconnect();
      });
      socket.addEventListener("error", () => {
        connectInProgress = false;
      });
      return true;
    } catch {
      connectInProgress = false;
      scheduleReconnect();
      return false;
    }
  }

  function notifyWorkflowStatus(payload) {
    sendRaw({
      action: "WORKFLOW_STATUS",
      workflowId: payload.workflowId || "",
      workflowName: payload.workflowName || "",
      stepIndex: typeof payload.stepIndex === "number" ? payload.stepIndex : -1,
      running: payload.running === true,
      status: payload.status || "idle",
      message: payload.message || "Estado remoto actualizado."
    });
  }

  function registerBridgeLifecycle() {
    if (chrome.alarms) {
      chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
      chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === RECONNECT_ALARM) {
          void ensureConnected("alarm");
        }
      });
    }

    chrome.runtime.onStartup.addListener(() => {
      void ensureConnected("startup");
    });

    chrome.runtime.onInstalled.addListener(() => {
      void ensureConnected("installed");
    });
  }

  globalThis.ChatGPTRemoteBridge = {
    ensureConnected,
    notifyWorkflowStatus,
    sendRequest,
    registerBridgeLifecycle
  };
})();