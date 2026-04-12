const AI_STUDIO_BRIDGE_URL = "ws://127.0.0.1:8766";
const AI_STUDIO_BRIDGE_ALARM = "aiStudioBridgeHeartbeat";
const AI_STUDIO_BRIDGE_ALARM_PERIOD_MINUTES = 0.5;
const AI_STUDIO_BRIDGE_BASE_RECONNECT_DELAY_MS = 2000;
const AI_STUDIO_BRIDGE_MAX_RECONNECT_DELAY_MS = 30000;
const AI_STUDIO_BRIDGE_HEARTBEAT_MS = 20000;
const AI_STUDIO_WORKFLOW_SESSION_SYNC_DEBOUNCE_MS = 400;
const AI_STUDIO_EXTENSION_TYPE = "autoyepeto";
const AI_STUDIO_INSTANCE_ID = "default";
const AI_STUDIO_SIDEPANEL_PORT_NAME = "aiStudioSidepanel";
const AI_STUDIO_TERMINAL_WORKFLOW_STATUSES = new Set(["completed", "done", "aborted", "failed", "stopped"]);

let aiStudioSocket = null;
let aiStudioReconnectTimer = null;
let aiStudioHeartbeatTimer = null;
let aiStudioSessionSyncTimer = null;
let aiStudioConnecting = false;
let aiStudioReconnectAttempt = 0;
let aiStudioLastForwardedWorkflowStatusKey = "";
const aiStudioSidePanelPorts = new Set();

function getWorkflowStorageKey() {
  return CONFIG?.STORAGE_KEYS?.WORKFLOWS || "savedWorkflows";
}

function getRemoteWorkflowSessionStorageKey() {
  return CONFIG?.STORAGE_KEYS?.REMOTE_WORKFLOW_SESSION || "remoteWorkflowSession";
}

function normalizeWorkflowCatalog(workflows) {
  if (!Array.isArray(workflows)) {
    return [];
  }

  return workflows
    .filter((workflow) => workflow && typeof workflow === "object")
    .map((workflow, index) => {
      const workflowId = typeof workflow.id === "string" && workflow.id.trim()
        ? workflow.id.trim()
        : "";
      if (!workflowId) {
        return null;
      }

      const steps = Array.isArray(workflow.steps)
        ? workflow.steps.filter((step) => step && typeof step === "object")
        : [];

      const providerIds = [];
      steps.forEach((step) => {
        const providerId = typeof step.provider === "string" && step.provider.trim()
          ? step.provider.trim()
          : "chatgpt";
        if (!providerIds.includes(providerId)) {
          providerIds.push(providerId);
        }
      });

      return {
        id: workflowId,
        name: typeof workflow.name === "string" && workflow.name.trim()
          ? workflow.name.trim()
          : `Workflow ${index + 1}`,
        stepCount: steps.length,
        providerIds,
      };
    })
    .filter(Boolean);
}

async function getStoredWorkflowCatalog() {
  const storageKey = getWorkflowStorageKey();
  const stored = await chrome.storage.local.get([storageKey]);
  return normalizeWorkflowCatalog(stored[storageKey]);
}

async function getStoredRemoteWorkflowSession() {
  const storageKey = getRemoteWorkflowSessionStorageKey();
  const stored = await chrome.storage.local.get([storageKey]);
  const session = stored[storageKey];
  if (!session || typeof session !== "object") {
    return null;
  }

  return { ...session };
}

function isAiStudioSocketOpen() {
  return aiStudioSocket && aiStudioSocket.readyState === WebSocket.OPEN;
}

function clearAiStudioReconnectTimer() {
  if (aiStudioReconnectTimer) {
    clearTimeout(aiStudioReconnectTimer);
    aiStudioReconnectTimer = null;
  }
}

function clearAiStudioSessionSyncTimer() {
  if (aiStudioSessionSyncTimer) {
    clearTimeout(aiStudioSessionSyncTimer);
    aiStudioSessionSyncTimer = null;
  }
}

function stopAiStudioHeartbeat() {
  if (aiStudioHeartbeatTimer) {
    clearInterval(aiStudioHeartbeatTimer);
    aiStudioHeartbeatTimer = null;
  }
}

function computeAiStudioReconnectDelayMs() {
  const backoffMs = Math.min(
    AI_STUDIO_BRIDGE_MAX_RECONNECT_DELAY_MS,
    AI_STUDIO_BRIDGE_BASE_RECONNECT_DELAY_MS * (2 ** Math.max(0, aiStudioReconnectAttempt)),
  );
  aiStudioReconnectAttempt += 1;
  return Math.min(
    AI_STUDIO_BRIDGE_MAX_RECONNECT_DELAY_MS,
    backoffMs + Math.floor(Math.random() * 750),
  );
}

function scheduleAiStudioReconnect(reason = "unknown") {
  clearAiStudioReconnectTimer();
  const delayMs = computeAiStudioReconnectDelayMs();
  aiStudioReconnectTimer = setTimeout(() => {
    aiStudioReconnectTimer = null;
    void ensureAiStudioBridgeConnection(`reconnect:${reason}`);
  }, delayMs);
}

function sendAiStudioSocketMessage(payload) {
  if (!isAiStudioSocketOpen()) {
    return false;
  }

  try {
    aiStudioSocket.send(JSON.stringify(payload));
    return true;
  } catch {
    try {
      aiStudioSocket?.close();
    } catch {
    }
    return false;
  }
}

async function sendAiStudioHeartbeat(reason = "heartbeat") {
  if (!isAiStudioSocketOpen()) {
    return false;
  }

  const session = await getStoredRemoteWorkflowSession();
  return sendAiStudioSocketMessage({
    action: "HEARTBEAT",
    extensionType: AI_STUDIO_EXTENSION_TYPE,
    instanceId: AI_STUDIO_INSTANCE_ID,
    version: CONFIG.APP_VERSION,
    reason,
    timestamp: Date.now(),
    sidePanelOpen: aiStudioSidePanelPorts.size > 0,
    workflowSession: session || undefined,
  });
}

function startAiStudioHeartbeat() {
  stopAiStudioHeartbeat();
  aiStudioHeartbeatTimer = setInterval(() => {
    void sendAiStudioHeartbeat("interval");
  }, AI_STUDIO_BRIDGE_HEARTBEAT_MS);
}

function debouncePublishStoredRemoteWorkflowSession(reason = "storage-change") {
  clearAiStudioSessionSyncTimer();
  aiStudioSessionSyncTimer = setTimeout(() => {
    aiStudioSessionSyncTimer = null;
    void publishStoredRemoteWorkflowSession(reason);
  }, AI_STUDIO_WORKFLOW_SESSION_SYNC_DEBOUNCE_MS);
}

async function publishWorkflowCatalog(replyTo = "") {
  if (!isAiStudioSocketOpen()) {
    return false;
  }

  const workflows = await getStoredWorkflowCatalog();
  return sendAiStudioSocketMessage({
    action: "WORKFLOW_CATALOG",
    extensionType: AI_STUDIO_EXTENSION_TYPE,
    workflows,
    replyTo: replyTo || undefined,
  });
}

async function publishStoredRemoteWorkflowSession(reason = "session-sync") {
  if (!isAiStudioSocketOpen()) {
    return false;
  }

  const session = await getStoredRemoteWorkflowSession();
  if (!session) {
    return false;
  }

  const sessionStatus = typeof session.status === "string"
    ? session.status.trim().toLowerCase()
    : "";
  if (AI_STUDIO_TERMINAL_WORKFLOW_STATUSES.has(sessionStatus)) {
    return false;
  }

  return sendAiStudioSocketMessage({
    action: "WORKFLOW_STATUS",
    extensionType: AI_STUDIO_EXTENSION_TYPE,
    status: session.status || "started",
    requestId: session.requestId,
    sessionId: typeof session.sessionId === "string" && session.sessionId.trim()
      ? session.sessionId.trim()
      : undefined,
    workflowId: session.workflowId,
    workflowName: session.workflowName,
    providerId: session.providerId,
    stepIndex: session.stepIndex,
    stepTitle: session.stepTitle,
    totalSteps: session.totalSteps,
    message: session.message || "",
    timestamp: Date.now(),
    syncedFrom: reason,
    fromStoredSession: true,
  });
}

async function ensureSidePanelUi(windowId) {
  try {
    await chrome.sidePanel.open({ windowId });
    return { success: true, mode: "sidepanel" };
  } catch {
  }

  const sidepanelUrl = chrome.runtime.getURL("sidepanel.html");
  const existingTabs = await chrome.tabs.query({ url: sidepanelUrl });
  const existingTab = existingTabs.find((tab) => tab && tab.id);

  if (existingTab?.id) {
    await chrome.tabs.update(existingTab.id, { active: true });
    return { success: true, mode: "tab", tabId: existingTab.id };
  }

  const createdTab = await chrome.tabs.create({ url: sidepanelUrl, active: true });
  return { success: Boolean(createdTab?.id), mode: "tab", tabId: createdTab?.id || null };
}

async function handleStartWorkflowRequest(message) {
  const bridgeRequestId = typeof message.requestId === "string" ? message.requestId.trim() : "";
  const workflowId = typeof message.workflowId === "string" ? message.workflowId.trim() : "";
  const providerId = typeof message.providerId === "string" && message.providerId.trim()
    ? message.providerId.trim()
    : "aistudio";
  const sessionId = typeof message.sessionId === "string" ? message.sessionId.trim() : "";

  const workflows = await getStoredWorkflowCatalog();
  const workflow = workflows.find((entry) => entry.id === workflowId) || null;

  if (!workflowId || !workflow) {
    sendAiStudioSocketMessage({
      action: "WORKFLOW_START_ACK",
      replyTo: bridgeRequestId || undefined,
      requestId: bridgeRequestId || undefined,
      workflowRequestId: bridgeRequestId || undefined,
      ok: false,
      workflowId,
      providerId,
      message: "No se encontró el workflow solicitado en la extensión.",
    });
    return;
  }

  try {
    const providerConfig = await getProviderById(providerId) || CONFIG.PROVIDERS?.aistudio;
    if (!providerConfig) {
      throw new Error(`No se encontró el provider ${providerId}.`);
    }

    const tab = await findOrCreateProviderTab(providerConfig, false, false);
    const uiResult = await ensureSidePanelUi(tab.windowId);

    await forwardToSidePanel({
      type: "REMOTE_START_WORKFLOW",
      requestId: bridgeRequestId,
      sessionId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      providerId,
      projectFolder: typeof message.projectFolder === "string" ? message.projectFolder : "",
      timestamp: Date.now(),
    });

    sendAiStudioSocketMessage({
      action: "WORKFLOW_START_ACK",
      replyTo: bridgeRequestId || undefined,
      requestId: bridgeRequestId || undefined,
      workflowRequestId: bridgeRequestId || undefined,
      ok: true,
      workflowId: workflow.id,
      workflowName: workflow.name,
      providerId,
      tabId: tab?.id || null,
      uiMode: uiResult.mode,
      message: `Workflow ${workflow.name} enviado al sidepanel.`,
    });
  } catch (error) {
    sendAiStudioSocketMessage({
      action: "WORKFLOW_START_ACK",
      replyTo: bridgeRequestId || undefined,
      requestId: bridgeRequestId || undefined,
      workflowRequestId: bridgeRequestId || undefined,
      ok: false,
      workflowId: workflow.id,
      workflowName: workflow.name,
      providerId,
      message: error?.message || "No se pudo iniciar el workflow remoto.",
    });
  }
}

async function handleStopWorkflowRequest(message) {
  const stopRequestId = typeof message.requestId === "string" ? message.requestId.trim() : "";
  const workflowRequestId = typeof message.workflowRequestId === "string"
    ? message.workflowRequestId.trim()
    : "";
  const workflowId = typeof message.workflowId === "string" ? message.workflowId.trim() : "";
  const storedSession = await getStoredRemoteWorkflowSession();

  const targetWorkflowRequestId = workflowRequestId || storedSession?.requestId || "";
  const targetWorkflowId = workflowId || storedSession?.workflowId || "";
  const targetWorkflowName = storedSession?.workflowName || "";
  const targetProviderId = storedSession?.providerId || "";

  if (!targetWorkflowRequestId && !targetWorkflowId) {
    sendAiStudioSocketMessage({
      action: "WORKFLOW_STOP_ACK",
      replyTo: stopRequestId || undefined,
      ok: false,
      workflowRequestId: workflowRequestId || undefined,
      workflowId: workflowId || undefined,
      message: "No hay un workflow remoto activo para detener.",
    });
    return;
  }

  await forwardToSidePanel({
    type: "REMOTE_STOP_WORKFLOW",
    workflowRequestId: targetWorkflowRequestId,
    workflowId: targetWorkflowId,
    workflowName: targetWorkflowName,
    providerId: targetProviderId,
    timestamp: Date.now(),
  });

  sendAiStudioSocketMessage({
    action: "WORKFLOW_STOP_ACK",
    replyTo: stopRequestId || undefined,
    ok: true,
    workflowRequestId: targetWorkflowRequestId || undefined,
    workflowId: targetWorkflowId || undefined,
    workflowName: targetWorkflowName || undefined,
    providerId: targetProviderId || undefined,
    stopping: true,
    message: storedSession
      ? "Se envió la solicitud de detención al sidepanel."
      : "Se registró una solicitud de detención pendiente para el sidepanel.",
  });
}

function forwardWorkflowStatusToBridge(message) {
  if (!isAiStudioSocketOpen()) {
    return false;
  }

  const statusKey = [
    typeof message.requestId === "string" ? message.requestId.trim() : "",
    typeof message.sessionId === "string" ? message.sessionId.trim() : "",
    typeof message.workflowId === "string" ? message.workflowId.trim() : "",
    Number.isInteger(message.stepIndex) ? String(message.stepIndex) : "",
    typeof message.status === "string" ? message.status.trim() : "",
  ].join("|");

  if (statusKey && statusKey === aiStudioLastForwardedWorkflowStatusKey) {
    return false;
  }

  const forwarded = sendAiStudioSocketMessage({
    action: "WORKFLOW_STATUS",
    extensionType: AI_STUDIO_EXTENSION_TYPE,
    status: message.status,
    requestId: message.requestId,
    sessionId: typeof message.sessionId === "string" && message.sessionId.trim()
      ? message.sessionId.trim()
      : undefined,
    workflowId: message.workflowId,
    workflowName: message.workflowName,
    providerId: message.providerId,
    stepIndex: message.stepIndex,
    stepTitle: message.stepTitle,
    totalSteps: message.totalSteps,
    message: message.message,
    timestamp: Date.now(),
  });

  if (forwarded && statusKey) {
    aiStudioLastForwardedWorkflowStatusKey = statusKey;
  }

  return forwarded;
}

function handleAiStudioBridgeMessage(event) {
  let data;
  try {
    data = JSON.parse(event.data);
  } catch {
    return;
  }

  switch (data.action) {
    case "PING":
      sendAiStudioSocketMessage({
        action: "PONG",
        replyTo: data.requestId || undefined,
        extensionType: AI_STUDIO_EXTENSION_TYPE,
        version: CONFIG.APP_VERSION,
        timestamp: Date.now(),
      });
      break;
    case "REQUEST_WORKFLOW_CATALOG":
      void publishWorkflowCatalog(data.requestId || "");
      break;
    case "START_WORKFLOW":
      void handleStartWorkflowRequest(data);
      break;
    case "STOP_WORKFLOW":
      void handleStopWorkflowRequest(data);
      break;
    default:
      break;
  }
}

function connectAiStudioBridgeSocket(reason = "manual") {
  if (aiStudioConnecting || isAiStudioSocketOpen()) {
    return;
  }

  aiStudioConnecting = true;

  try {
    aiStudioSocket = new WebSocket(AI_STUDIO_BRIDGE_URL);
  } catch {
    aiStudioConnecting = false;
    scheduleAiStudioReconnect(reason);
    return;
  }

  aiStudioSocket.addEventListener("open", async () => {
    aiStudioConnecting = false;
    aiStudioReconnectAttempt = 0;
    clearAiStudioReconnectTimer();
    startAiStudioHeartbeat();

    sendAiStudioSocketMessage({
      action: "EXTENSION_CONNECTED",
      extensionType: AI_STUDIO_EXTENSION_TYPE,
      instanceId: AI_STUDIO_INSTANCE_ID,
      version: CONFIG.APP_VERSION,
    });

    await publishWorkflowCatalog();
    await sendAiStudioHeartbeat("socket-open");
    await publishStoredRemoteWorkflowSession("socket-open");
  });

  aiStudioSocket.addEventListener("message", handleAiStudioBridgeMessage);

  aiStudioSocket.addEventListener("close", () => {
    aiStudioSocket = null;
    aiStudioConnecting = false;
    stopAiStudioHeartbeat();
    clearAiStudioSessionSyncTimer();
    scheduleAiStudioReconnect(reason);
  });

  aiStudioSocket.addEventListener("error", () => {
    aiStudioConnecting = false;
    try {
      aiStudioSocket?.close();
    } catch {
    }
  });
}

async function ensureAiStudioBridgeConnection(reason = "manual") {
  if (isAiStudioSocketOpen() || aiStudioConnecting) {
    return;
  }

  connectAiStudioBridgeSocket(reason);
}

function ensureAiStudioAlarm() {
  if (!chrome.alarms?.create) {
    return;
  }

  try {
    chrome.alarms.create(AI_STUDIO_BRIDGE_ALARM, { periodInMinutes: AI_STUDIO_BRIDGE_ALARM_PERIOD_MINUTES });
  } catch {
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes[getWorkflowStorageKey()]) {
    void publishWorkflowCatalog();
  }

  if (changes[getRemoteWorkflowSessionStorageKey()]) {
    debouncePublishStoredRemoteWorkflowSession("storage-change");
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "WORKFLOW_REMOTE_EVENT") {
    const forwarded = forwardWorkflowStatusToBridge(message);
    sendResponse({ received: forwarded });
    return true;
  }

  return false;
});

if (chrome.runtime?.onConnect) {
  chrome.runtime.onConnect.addListener((port) => {
    if (port?.name !== AI_STUDIO_SIDEPANEL_PORT_NAME) {
      return;
    }

    aiStudioSidePanelPorts.add(port);
    void ensureAiStudioBridgeConnection("sidepanel-connect");
    void sendAiStudioHeartbeat("sidepanel-connect");

    port.onMessage.addListener((message) => {
      if (message?.type !== "AI_STUDIO_SIDEPANEL_HEARTBEAT") {
        return;
      }

      void ensureAiStudioBridgeConnection("sidepanel-heartbeat");
      void sendAiStudioHeartbeat("sidepanel-heartbeat");
      if (message.remoteWorkflowRequestId && message.hasActiveWorkflow === true) {
        debouncePublishStoredRemoteWorkflowSession("sidepanel-heartbeat");
      }
    });

    port.onDisconnect.addListener(() => {
      aiStudioSidePanelPorts.delete(port);
    });
  });
}

if (chrome.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name !== AI_STUDIO_BRIDGE_ALARM) {
      return;
    }

    if (isAiStudioSocketOpen()) {
      void sendAiStudioHeartbeat("alarm");
      return;
    }

    void ensureAiStudioBridgeConnection("alarm");
  });
}

if (chrome.runtime?.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    ensureAiStudioAlarm();
    void ensureAiStudioBridgeConnection("runtime-startup");
  });
}

if (chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(() => {
    ensureAiStudioAlarm();
    void ensureAiStudioBridgeConnection("runtime-installed");
  });
}

ensureAiStudioAlarm();
void ensureAiStudioBridgeConnection("service-worker-start");