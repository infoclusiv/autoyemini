import { normalizeWorkflows } from "../services/workflowService.js";

const WORKFLOWS_KEY = "savedWorkflows";
const TEMPLATES_KEY = "savedTemplates";

const { generateUUID } = globalThis.SharedUtils;

// ─── State ────────────────────────────────────────────────
let workflows = [];
let templates = [];
let selectedWorkflowId = "";

// ─── Storage helpers ──────────────────────────────────────
function normalizeTemplatesSimple(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t) => t && typeof t === "object" && t.id && t.name)
    .map((t) => ({
      id: String(t.id),
      name: String(t.name),
      content: String(t.content || "")
    }));
}

async function load() {
  const stored = await chrome.storage.local.get([WORKFLOWS_KEY, TEMPLATES_KEY]);
  templates = normalizeTemplatesSimple(stored[TEMPLATES_KEY]);
  workflows = normalizeWorkflows(stored[WORKFLOWS_KEY], templates);
  // Keep selected ID valid after reload
  if (selectedWorkflowId && !workflows.some((wf) => wf.id === selectedWorkflowId)) {
    selectedWorkflowId = workflows.length > 0 ? workflows[0].id : "";
  }
  if (!selectedWorkflowId && workflows.length > 0) {
    selectedWorkflowId = workflows[0].id;
  }
}

async function persist() {
  await chrome.storage.local.set({ [WORKFLOWS_KEY]: workflows });
}

// ─── Getters ──────────────────────────────────────────────
function getSelectedWorkflow() {
  return workflows.find((wf) => wf.id === selectedWorkflowId) || null;
}

// ─── Render: workflow select ──────────────────────────────
function renderWorkflowSelect() {
  const sel = document.getElementById("editorWorkflowSelect");
  sel.innerHTML = "";

  if (workflows.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "— No workflows yet —";
    sel.appendChild(opt);
  } else {
    workflows.forEach((wf) => {
      const opt = document.createElement("option");
      opt.value = wf.id;
      opt.textContent = `${wf.name}  (${wf.steps.length} step${wf.steps.length !== 1 ? "s" : ""})`;
      sel.appendChild(opt);
    });
    if (selectedWorkflowId && workflows.some((wf) => wf.id === selectedWorkflowId)) {
      sel.value = selectedWorkflowId;
    } else {
      sel.value = workflows[0].id;
      selectedWorkflowId = workflows[0].id;
    }
  }
}

// ─── Render: template select ─────────────────────────────
function renderTemplateSelect() {
  const sel = document.getElementById("editorTemplateSelect");
  sel.innerHTML = "";

  const def = document.createElement("option");
  def.value = "";
  def.textContent = "— Select template to add —";
  sel.appendChild(def);

  templates.forEach((tpl) => {
    const opt = document.createElement("option");
    opt.value = tpl.id;
    opt.textContent = tpl.name;
    sel.appendChild(opt);
  });
}

// ─── Render: canvas ───────────────────────────────────────
const ACTION_LABELS = {
  extract: "extract",
  store_full: "full",
  none: "—"
};

const ACTION_OPTIONS = [
  { value: "none", label: "⏭️ Pass through" },
  { value: "extract", label: "🔍 Extract (regex)" },
  { value: "store_full", label: "📋 Store full response" }
];

function renderCanvas() {
  const canvas = document.getElementById("editorCanvas");
  const emptyState = document.getElementById("editorEmptyState");
  const noSteps = document.getElementById("editorNoSteps");

  canvas.innerHTML = "";

  const workflow = getSelectedWorkflow();

  if (!workflow) {
    emptyState.style.display = "flex";
    noSteps.style.display = "none";
    canvas.style.display = "none";
    return;
  }

  emptyState.style.display = "none";

  if (workflow.steps.length === 0) {
    noSteps.style.display = "flex";
    canvas.style.display = "none";
    return;
  }

  noSteps.style.display = "none";
  canvas.style.display = "flex";

  workflow.steps.forEach((step, index) => {
    const tpl = templates.find((t) => t.id === step.templateId);
    const action = step.chainConfig?.responseAction || "none";

    // ── Connector arrow (before each step except the first) ──
    if (index > 0) {
      const prevAction = workflow.steps[index - 1].chainConfig?.responseAction || "none";
      const isActive = prevAction !== "none";

      const connector = document.createElement("div");
      connector.className = "editor-connector" + (isActive ? " editor-connector-active" : "");

      const line = document.createElement("div");
      line.className = "editor-connector-line";

      const label = document.createElement("div");
      label.className = "editor-connector-label";
      label.textContent = ACTION_LABELS[prevAction] || "—";
      if (prevAction === "extract") label.classList.add("connector-label-extract");
      else if (prevAction === "store_full") label.classList.add("connector-label-full");

      const arrow = document.createElement("div");
      arrow.className = "editor-connector-arrow";
      arrow.textContent = "→";

      connector.appendChild(line);
      connector.appendChild(label);
      connector.appendChild(arrow);
      canvas.appendChild(connector);
    }

    // ── Node card ─────────────────────────────────────────
    const node = document.createElement("div");
    node.className = "editor-node" + (!tpl ? " editor-node-invalid" : "");

    // Header
    const header = document.createElement("div");
    header.className = "editor-node-header";

    const stepNum = document.createElement("div");
    stepNum.className = "editor-node-step-num";
    stepNum.textContent = `STEP ${index + 1}`;

    const btns = document.createElement("div");
    btns.className = "editor-node-btns";

    if (index > 0) {
      const leftBtn = document.createElement("button");
      leftBtn.className = "editor-node-btn";
      leftBtn.title = "Move left";
      leftBtn.textContent = "←";
      leftBtn.addEventListener("click", () => void moveStep(workflow.id, index, index - 1));
      btns.appendChild(leftBtn);
    }

    if (index < workflow.steps.length - 1) {
      const rightBtn = document.createElement("button");
      rightBtn.className = "editor-node-btn";
      rightBtn.title = "Move right";
      rightBtn.textContent = "→";
      rightBtn.addEventListener("click", () => void moveStep(workflow.id, index, index + 1));
      btns.appendChild(rightBtn);
    }

    const removeBtn = document.createElement("button");
    removeBtn.className = "editor-node-btn editor-node-btn-remove";
    removeBtn.title = "Remove step";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => void removeStep(workflow.id, index));
    btns.appendChild(removeBtn);

    header.appendChild(stepNum);
    header.appendChild(btns);

    // Template name
    const tplName = document.createElement("div");
    tplName.className = "editor-node-tpl-name";
    tplName.textContent = tpl ? tpl.name : "⚠️ Template not found";
    tplName.title = tpl ? tpl.name : "Template is missing";

    // Response action row
    const responseRow = document.createElement("div");
    responseRow.className = "editor-node-response-row";

    const responseLabel = document.createElement("span");
    responseLabel.className = "editor-node-response-label";
    responseLabel.textContent = "Response Action";

    const actionSel = document.createElement("select");
    actionSel.className = "editor-node-action-select";
    ACTION_OPTIONS.forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      actionSel.appendChild(o);
    });
    actionSel.value = action;
    actionSel.addEventListener("change", () => {
      void updateStepAction(workflow.id, index, actionSel.value);
    });

    responseRow.appendChild(responseLabel);
    responseRow.appendChild(actionSel);

    // Badge
    const badge = document.createElement("div");
    badge.className = `editor-node-badge editor-badge-${action}`;
    if (action === "extract") badge.textContent = "🔍 Extracts data";
    else if (action === "store_full") badge.textContent = "📋 Stores full response";
    else badge.textContent = "⏭️ Passes through";

    // ── Extraction config row (shown when responseAction === "extract") ──
    const regexRow = document.createElement("div");
    regexRow.className = "editor-node-regex-row" + (action !== "extract" ? " is-hidden" : "");

    const regexLabel = document.createElement("label");
    regexLabel.className = "editor-node-field-label";
    regexLabel.textContent = "🔍 Regex pattern:";

    const regexInput = document.createElement("input");
    regexInput.type = "text";
    regexInput.className = "editor-node-field-input";
    regexInput.placeholder = globalThis.CONFIG?.EXTRACTION?.DEFAULT_REGEX || "<extract>(.*?)</extract>";
    regexInput.value = step.chainConfig?.extractionRegex || globalThis.CONFIG?.EXTRACTION?.DEFAULT_REGEX || "<extract>(.*?)</extract>";
    regexInput.title = "Regex pattern to extract text from the response (must have one capture group)";
    regexInput.addEventListener("change", () => {
      void updateStepChainField(workflow.id, index, "extractionRegex", regexInput.value.trim() || regexInput.placeholder);
    });

    regexRow.appendChild(regexLabel);
    regexRow.appendChild(regexInput);

    // Show/hide regexRow when responseAction changes
    actionSel.addEventListener("change", () => {
      regexRow.classList.toggle("is-hidden", actionSel.value !== "extract");
    });

    // ── Injection config row (placeholder input) ──
    const isFirstStep = index === 0;
    const prevStep = index > 0 ? workflow.steps[index - 1] : null;
    const prevHasOutput = prevStep && prevStep.chainConfig?.responseAction !== "none";

    const injectionRow = document.createElement("div");
    let injectionRowClass = "editor-node-injection-row";
    if (isFirstStep) {
      injectionRowClass += " is-disabled";
    } else if (!prevHasOutput) {
      injectionRowClass += " is-inactive";
    }
    injectionRow.className = injectionRowClass;

    const injectionLabel = document.createElement("label");
    injectionLabel.className = "editor-node-field-label";
    if (isFirstStep) {
      injectionLabel.textContent = "📥 Injection placeholder: (no prior step)";
    } else if (!prevHasOutput) {
      injectionLabel.textContent = "📥 Injection placeholder: (prior step has no output)";
    } else {
      injectionLabel.textContent = "📥 Injection placeholder:";
    }

    const injectionInput = document.createElement("input");
    injectionInput.type = "text";
    injectionInput.className = "editor-node-field-input";
    injectionInput.placeholder = globalThis.CONFIG?.EXTRACTION?.DEFAULT_PLACEHOLDER || "{{extract}}";
    injectionInput.value = step.chainConfig?.injectionPlaceholder || globalThis.CONFIG?.EXTRACTION?.DEFAULT_PLACEHOLDER || "{{extract}}";
    injectionInput.title = "Placeholder text in this template that will be replaced by the previous step's output";
    injectionInput.disabled = isFirstStep;
    injectionInput.addEventListener("change", () => {
      void updateStepChainField(workflow.id, index, "injectionPlaceholder", injectionInput.value.trim() || injectionInput.placeholder);
    });

    injectionRow.appendChild(injectionLabel);
    injectionRow.appendChild(injectionInput);

    // ── Last-step extraction warning ──
    const isLastStep = index === workflow.steps.length - 1;
    const lastStepWarning =
      isLastStep && action !== "none"
        ? (() => {
            const el = document.createElement("div");
            el.className = "editor-node-last-step-warning";
            el.textContent = "⚠️ Last step — extracted/stored data won't be passed further";
            return el;
          })()
        : null;

    node.appendChild(header);
    node.appendChild(tplName);
    node.appendChild(responseRow);
    node.appendChild(badge);
    node.appendChild(regexRow);
    node.appendChild(injectionRow);
    if (lastStepWarning) node.appendChild(lastStepWarning);

    canvas.appendChild(node);
  });

  // ── "+ Add Step" placeholder at the end ──────────────────
  const addNode = document.createElement("div");
  addNode.className = "editor-add-node";

  const addIcon = document.createElement("div");
  addIcon.className = "editor-add-node-icon";
  addIcon.textContent = "+";

  const addText = document.createElement("div");
  addText.className = "editor-add-node-text";
  addText.textContent = "Add Step";

  addNode.appendChild(addIcon);
  addNode.appendChild(addText);
  addNode.title = "Select a template in the toolbar, then click here";
  addNode.addEventListener("click", () => {
    const tplSel = document.getElementById("editorTemplateSelect");
    if (!tplSel.value) {
      alert("Select a template in the toolbar first, then click Add Step.");
      return;
    }
    void handleAddStep(tplSel.value);
  });

  canvas.appendChild(addNode);
}

// ─── CRUD: workflows ──────────────────────────────────────
async function handleNewWorkflow() {
  const name = window.prompt("New workflow name:", "");
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) return;

  const wf = { id: generateUUID(), name: trimmed, steps: [] };
  workflows = [...workflows, wf];
  selectedWorkflowId = wf.id;

  await persist();
  renderWorkflowSelect();
  renderCanvas();
}

async function handleRenameWorkflow() {
  const wf = getSelectedWorkflow();
  if (!wf) {
    alert("No workflow selected.");
    return;
  }

  const name = window.prompt("New name:", wf.name);
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) return;

  workflows = workflows.map((w) => (w.id === wf.id ? { ...w, name: trimmed } : w));
  await persist();
  renderWorkflowSelect();
}

async function handleDeleteWorkflow() {
  const wf = getSelectedWorkflow();
  if (!wf) {
    alert("No workflow selected.");
    return;
  }

  if (!window.confirm(`Delete workflow "${wf.name}"? This cannot be undone.`)) return;

  workflows = workflows.filter((w) => w.id !== wf.id);
  selectedWorkflowId = workflows.length > 0 ? workflows[0].id : "";

  await persist();
  renderWorkflowSelect();
  renderCanvas();
}

// ─── CRUD: steps ──────────────────────────────────────────
async function handleAddStep(templateId) {
  const wf = getSelectedWorkflow();
  if (!wf) return;

  const defaultRegex =
    globalThis.CONFIG?.EXTRACTION?.DEFAULT_REGEX || "<extract>(.*?)</extract>";
  const defaultPlaceholder =
    globalThis.CONFIG?.EXTRACTION?.DEFAULT_PLACEHOLDER || "{{extract}}";

  const newStep = {
    templateId,
    order: wf.steps.length,
    chainConfig: {
      responseAction: "none",
      extractionRegex: defaultRegex,
      injectionPlaceholder: defaultPlaceholder
    }
  };

  workflows = workflows.map((w) => {
    if (w.id !== wf.id) return w;
    return { ...w, steps: [...w.steps, newStep] };
  });

  await persist();
  renderWorkflowSelect();
  renderCanvas();
  document.getElementById("editorTemplateSelect").value = "";
}

async function removeStep(workflowId, stepIndex) {
  workflows = workflows.map((w) => {
    if (w.id !== workflowId) return w;
    const steps = w.steps
      .filter((_, i) => i !== stepIndex)
      .map((s, i) => ({ ...s, order: i }));
    return { ...w, steps };
  });

  await persist();
  renderWorkflowSelect();
  renderCanvas();
}

async function moveStep(workflowId, fromIndex, toIndex) {
  workflows = workflows.map((w) => {
    if (w.id !== workflowId) return w;
    const steps = [...w.steps];
    const [moved] = steps.splice(fromIndex, 1);
    steps.splice(toIndex, 0, moved);
    return { ...w, steps: steps.map((s, i) => ({ ...s, order: i })) };
  });

  await persist();
  renderCanvas();
}

async function updateStepAction(workflowId, stepIndex, responseAction) {
  workflows = workflows.map((w) => {
    if (w.id !== workflowId) return w;
    const steps = w.steps.map((s, i) => {
      if (i !== stepIndex) return s;
      return { ...s, chainConfig: { ...s.chainConfig, responseAction } };
    });
    return { ...w, steps };
  });

  await persist();
  renderCanvas();
}

async function updateStepChainField(workflowId, stepIndex, field, value) {
  workflows = workflows.map((w) => {
    if (w.id !== workflowId) return w;
    const steps = w.steps.map((s, i) => {
      if (i !== stepIndex) return s;
      return { ...s, chainConfig: { ...s.chainConfig, [field]: value } };
    });
    return { ...w, steps };
  });

  await persist();
}

// ─── Event listeners ──────────────────────────────────────
function setupEventListeners() {
  document.getElementById("editorWorkflowSelect").addEventListener("change", (e) => {
    selectedWorkflowId = e.target.value;
    renderCanvas();
  });

  document.getElementById("editorNewBtn").addEventListener("click", () => void handleNewWorkflow());
  document.getElementById("editorRenameBtn").addEventListener("click", () => void handleRenameWorkflow());
  document.getElementById("editorDeleteBtn").addEventListener("click", () => void handleDeleteWorkflow());

  document.getElementById("editorAddStepBtn").addEventListener("click", () => {
    const tplSel = document.getElementById("editorTemplateSelect");
    if (!tplSel.value) {
      alert("Select a template first.");
      return;
    }
    void handleAddStep(tplSel.value);
  });
}

// ─── Init ─────────────────────────────────────────────────
async function init() {
  await load();
  renderWorkflowSelect();
  renderTemplateSelect();
  renderCanvas();
  setupEventListeners();

  // Reflect changes made from the sidepanel while this tab is open
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (!changes[WORKFLOWS_KEY] && !changes[TEMPLATES_KEY]) return;
    // Re-load but keep user's current selection
    load().then(() => {
      renderWorkflowSelect();
      renderTemplateSelect();
      renderCanvas();
    });
  });
}

document.addEventListener("DOMContentLoaded", () => void init());
