import { normalizeTemplates } from "./templateService.js";
import { normalizeWorkflows } from "./workflowService.js";

const storageKeys = globalThis.CONFIG?.STORAGE_KEYS || {
  QUESTIONS: "questions",
  TEMPLATES: "savedTemplates",
  USE_TEMP_CHAT: "useTempChat",
  USE_WEB_SEARCH: "useWebSearch",
  KEEP_SAME_CHAT: "keepSameChat",
  SINGLE_PROMPT_MODE: "singlePromptMode",
  PENDING_MESSAGE: "pendingMessage"
};

export const StorageKeys = storageKeys;

export async function loadAll() {
  const stored = await chrome.storage.local.get([
    StorageKeys.QUESTIONS,
    StorageKeys.TEMPLATES,
    StorageKeys.USE_TEMP_CHAT,
    StorageKeys.USE_WEB_SEARCH,
    StorageKeys.KEEP_SAME_CHAT,
    StorageKeys.SINGLE_PROMPT_MODE,
    StorageKeys.WORKFLOWS
  ]);

  const templates = normalizeTemplates(stored[StorageKeys.TEMPLATES]);

  return {
    questions: stored[StorageKeys.QUESTIONS] || [],
    templates,
    workflows: normalizeWorkflows(stored[StorageKeys.WORKFLOWS], templates),
    useTempChat: stored[StorageKeys.USE_TEMP_CHAT] !== false,
    useWebSearch: stored[StorageKeys.USE_WEB_SEARCH] !== false,
    keepSameChat: stored[StorageKeys.KEEP_SAME_CHAT] === true,
    singlePromptMode: stored[StorageKeys.SINGLE_PROMPT_MODE] === true
  };
}

export function saveQuestions(questions) {
  return chrome.storage.local.set({ [StorageKeys.QUESTIONS]: questions });
}

export function saveSetting(key, value) {
  return chrome.storage.local.set({ [key]: value });
}

export function removePendingMessage() {
  return chrome.storage.local.remove(StorageKeys.PENDING_MESSAGE);
}

export function saveWorkflows(workflows) {
  return chrome.storage.local.set({ [StorageKeys.WORKFLOWS]: workflows });
}

const WORKFLOWS_BACKUP_KEY = "workflowBackups";
const MAX_WORKFLOW_BACKUPS = 5;

export async function saveWorkflowBackup(workflow) {
  const stored = await chrome.storage.local.get([WORKFLOWS_BACKUP_KEY]);
  const backups = stored[WORKFLOWS_BACKUP_KEY] || [];
  const entry = {
    backupId: globalThis.SharedUtils.generateUUID(),
    timestamp: new Date().toISOString(),
    workflowId: workflow.id,
    workflowName: workflow.name,
    stepCount: workflow.steps.length,
    snapshot: JSON.parse(JSON.stringify(workflow))
  };
  const updated = [entry, ...backups].slice(0, MAX_WORKFLOW_BACKUPS);
  return chrome.storage.local.set({ [WORKFLOWS_BACKUP_KEY]: updated });
}

export async function loadWorkflowBackups() {
  const stored = await chrome.storage.local.get([WORKFLOWS_BACKUP_KEY]);
  return stored[WORKFLOWS_BACKUP_KEY] || [];
}

export function deleteAllWorkflowBackups() {
  return chrome.storage.local.remove(WORKFLOWS_BACKUP_KEY);
}