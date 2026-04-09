const AI_STUDIO_BRIDGE_URL = "ws://127.0.0.1:8766";
const AI_STUDIO_BRIDGE_ALARM = "aiStudioBridgeHeartbeat";
const AI_STUDIO_RECONNECT_DELAY_MS = 5000;
const AI_STUDIO_EXTENSION_TYPE = "autoyepeto";
const AI_STUDIO_INSTANCE_ID = "default";

let aiStudioSocket = null;
let aiStudioReconnectTimer = null;
let aiStudioConnecting = false;

function getWorkflowStorageKey() {
  return CONFIG?.STORAGE_KEYS?.WORKFLOWS || "savedWorkflows";
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
        providerIds
      };
    })
    .filter(Boolean);
}

async function getStoredWorkflowCatalog() {
  const storageKey = getWorkflowStorageKey();
  const stored = await chrome.storage.local.get([storageKey]);
  return normalizeWorkflowCatalog(stored[storageKey]);
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

function scheduleAiStudioReconnect() {
  clearAiStudioReconnectTimer();
  aiStudioReconnectTimer = setTimeout(() => {
    aiStudioReconnectTimer = null;
    void ensureAiStudioBridgeConnection();
  }, AI_STUDIO_RECONNECT_DELAY_MS);
}

function sendAiStudioSocketMessage(payload) {
  if (!isAiStudioSocketOpen()) {
    return false;
  }

  try {
    aiStudioSocket.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
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
    replyTo: replyTo || undefined
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
  const requestId = typeof message.requestId === "string" ? message.requestId : "";
  const workflowId = typeof message.workflowId === "string" ? message.workflowId.trim() : "";
  const providerId = typeof message.providerId === "string" && message.providerId.trim()
    ? message.providerId.trim()
    : "aistudio";

  const workflows = await getStoredWorkflowCatalog();
  const workflow = workflows.find((entry) => entry.id === workflowId) || null;

  if (!workflowId || !workflow) {
    sendAiStudioSocketMessage({
      action: "WORKFLOW_START_ACK",
      replyTo: requestId || undefined,
      ok: false,
      workflowId,
      message: "No se encontró el workflow solicitado en la extensión."
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
      requestId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      projectFolder: typeof message.projectFolder === "string" ? message.projectFolder : ""
    });

    sendAiStudioSocketMessage({
      action: "WORKFLOW_START_ACK",
      replyTo: requestId || undefined,
      ok: true,
      workflowId: workflow.id,
      workflowName: workflow.name,
      tabId: tab?.id || null,
      uiMode: uiResult.mode,
      message: `Workflow ${workflow.name} enviado al sidepanel.`
    });
  } catch (error) {
    sendAiStudioSocketMessage({
      action: "WORKFLOW_START_ACK",
      replyTo: requestId || undefined,
      ok: false,
      workflowId: workflow.id,
      workflowName: workflow.name,
      message: error?.message || "No se pudo iniciar el workflow remoto."
    });
  }
}

function forwardWorkflowStatusToBridge(message) {
  if (!isAiStudioSocketOpen()) {
    return false;
  }

  return sendAiStudioSocketMessage({
    action: "WORKFLOW_STATUS",
    extensionType: AI_STUDIO_EXTENSION_TYPE,
    status: message.status,
    requestId: message.requestId,
    workflowId: message.workflowId,
    workflowName: message.workflowName,
    stepIndex: message.stepIndex,
    stepTitle: message.stepTitle,
    totalSteps: message.totalSteps,
    message: message.message,
    timestamp: Date.now()
  });
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
        version: CONFIG.APP_VERSION
      });
      break;
    case "REQUEST_WORKFLOW_CATALOG":
      void publishWorkflowCatalog(data.requestId || "");
      break;
    case "START_WORKFLOW":
      void handleStartWorkflowRequest(data);
      break;
    default:
      break;
  }
}

function connectAiStudioBridgeSocket() {
  if (aiStudioConnecting || isAiStudioSocketOpen()) {
    return;
  }

  aiStudioConnecting = true;

  try {
    aiStudioSocket = new WebSocket(AI_STUDIO_BRIDGE_URL);
  } catch {
    aiStudioConnecting = false;
    scheduleAiStudioReconnect();
    return;
  }

  aiStudioSocket.addEventListener("open", async () => {
    aiStudioConnecting = false;
    clearAiStudioReconnectTimer();
    sendAiStudioSocketMessage({
      action: "EXTENSION_CONNECTED",
      extensionType: AI_STUDIO_EXTENSION_TYPE,
      instanceId: AI_STUDIO_INSTANCE_ID,
      version: CONFIG.APP_VERSION
    });
    await publishWorkflowCatalog();
  });

  aiStudioSocket.addEventListener("message", handleAiStudioBridgeMessage);

  aiStudioSocket.addEventListener("close", () => {
    aiStudioSocket = null;
    aiStudioConnecting = false;
    scheduleAiStudioReconnect();
  });

  aiStudioSocket.addEventListener("error", () => {
    aiStudioConnecting = false;
    try {
      aiStudioSocket?.close();
    } catch {
    }
  });
}

async function ensureAiStudioBridgeConnection() {
  if (isAiStudioSocketOpen() || aiStudioConnecting) {
    return;
  }
  connectAiStudioBridgeSocket();
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes[getWorkflowStorageKey()]) {
    void publishWorkflowCatalog();
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

if (chrome.alarms?.create) {
  chrome.alarms.create(AI_STUDIO_BRIDGE_ALARM, { periodInMinutes: 1 });
}

if (chrome.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name === AI_STUDIO_BRIDGE_ALARM) {
      void ensureAiStudioBridgeConnection();
    }
  });
}

if (chrome.runtime?.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    void ensureAiStudioBridgeConnection();
  });
}

if (chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(() => {
    void ensureAiStudioBridgeConnection();
  });
}

void ensureAiStudioBridgeConnection();