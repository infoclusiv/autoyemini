import { normalizeWorkflows } from "../services/workflowService.js";

const WORKFLOWS_KEY = "savedWorkflows";

const { generateUUID } = globalThis.SharedUtils;

// ─── State ────────────────────────────────────────────────
let workflows = [];
let selectedWorkflowId = "";

// ─── Modal state ──────────────────────────────────────────
let modalWorkflowId = null;
let modalStepIndex = -1;   // -1 = new step being created

// ─── Storage helpers ──────────────────────────────────────
async function load() {
  const stored = await chrome.storage.local.get([WORKFLOWS_KEY]);
  workflows = normalizeWorkflows(stored[WORKFLOWS_KEY]);
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
    node.className = "editor-node";

    // Header
    const header = document.createElement("div");
    header.className = "editor-node-header";

    const stepNum = document.createElement("div");
    stepNum.className = "editor-node-step-num";
    stepNum.textContent = `STEP ${index + 1}`;

    const btns = document.createElement("div");
    btns.className = "editor-node-btns";

    // Edit button (opens modal)
    const editBtn = document.createElement("button");
    editBtn.className = "editor-node-btn";
    editBtn.title = "Edit step title and prompt";
    editBtn.textContent = "✏️";
    editBtn.addEventListener("click", () => void openStepModal(workflow.id, index));
    btns.appendChild(editBtn);

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

    // Step title
    const tplName = document.createElement("div");
    tplName.className = "editor-node-tpl-name";
    tplName.textContent = step.title || `Step ${index + 1}`;
    tplName.title = step.title || "";

    // Content preview
    const contentPreview = document.createElement("div");
    contentPreview.className = "editor-node-content-preview";
    const previewText = step.content
      ? step.content.replace(/\n/g, " ").substring(0, 80) + (step.content.length > 80 ? "…" : "")
      : "(no prompt — click ✏️ to add)";
    contentPreview.textContent = previewText;

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

    // ── Anti-Bot Options (collapsible) ────────────────────
    const ab = step.antiBotConfig || {};
    const abHumanTyping = ab.humanTyping !== false;
    const abRandomDelays = ab.randomDelays !== false;
    const abBiologicalPauses = ab.biologicalPauses === true;
    const abTypingSpeed = Array.isArray(ab.typingSpeed) ? ab.typingSpeed : [30, 100];
    const abFatigueCount = ab.fatigueCount ?? 10;
    const abFatigueMin = ab.fatigueMinMinutes ?? 0.5;
    const abFatigueMax = ab.fatigueMaxMinutes ?? 1;

    // Summary label for the toggle button
    const abSummaryParts = [];
    if (abHumanTyping) abSummaryParts.push("typing");
    if (abRandomDelays) abSummaryParts.push("delays");
    if (abBiologicalPauses) abSummaryParts.push("pauses");
    const abSummary = abSummaryParts.length > 0 ? abSummaryParts.join(", ") : "all off";

    // Toggle row
    const antiBotToggle = document.createElement("div");
    antiBotToggle.className = "editor-node-antibot-toggle";

    const antiBotToggleBtn = document.createElement("button");
    antiBotToggleBtn.className = "editor-node-antibot-btn";
    antiBotToggleBtn.textContent = `🤖 Anti-Bot Options ▾`;
    antiBotToggleBtn.title = "Toggle Anti-Bot settings for this step";

    const antiBotSummary = document.createElement("span");
    antiBotSummary.className = "editor-node-antibot-summary";
    antiBotSummary.textContent = abSummary;

    antiBotToggle.appendChild(antiBotToggleBtn);
    antiBotToggle.appendChild(antiBotSummary);

    // Collapsible section
    const antiBotSection = document.createElement("div");
    antiBotSection.className = "editor-node-antibot-section is-hidden";

    // ── Human Typing row ──
    const htRow = document.createElement("div");
    htRow.className = "editor-antibot-row";
    const htLabel = document.createElement("label");
    htLabel.className = "editor-antibot-label";
    const htCb = document.createElement("input");
    htCb.type = "checkbox";
    htCb.checked = abHumanTyping;
    htLabel.appendChild(htCb);
    htLabel.append(" Human Typing");
    htRow.appendChild(htLabel);

    // Typing speed sub-row
    const tsRow = document.createElement("div");
    tsRow.className = "editor-antibot-subrow" + (abHumanTyping ? "" : " is-hidden");

    const tsMinLabel = document.createElement("label");
    tsMinLabel.className = "editor-antibot-field-label";
    tsMinLabel.textContent = "Min (ms):";
    const tsMinInput = document.createElement("input");
    tsMinInput.type = "number";
    tsMinInput.className = "editor-antibot-field-input";
    tsMinInput.min = "0";
    tsMinInput.step = "10";
    tsMinInput.value = String(abTypingSpeed[0]);

    const tsMaxLabel = document.createElement("label");
    tsMaxLabel.className = "editor-antibot-field-label";
    tsMaxLabel.textContent = "Max (ms):";
    const tsMaxInput = document.createElement("input");
    tsMaxInput.type = "number";
    tsMaxInput.className = "editor-antibot-field-input";
    tsMaxInput.min = "0";
    tsMaxInput.step = "10";
    tsMaxInput.value = String(abTypingSpeed[1]);

    function saveTypingSpeed() {
      const min = Math.max(0, parseInt(tsMinInput.value || "30", 10) || 30);
      const max = Math.max(min, parseInt(tsMaxInput.value || "100", 10) || 100);
      tsMinInput.value = String(min);
      tsMaxInput.value = String(max);
      void updateStepAntiBotField(workflow.id, index, "typingSpeed", [min, max]);
    }
    tsMinInput.addEventListener("change", saveTypingSpeed);
    tsMaxInput.addEventListener("change", saveTypingSpeed);

    tsRow.appendChild(tsMinLabel);
    tsRow.appendChild(tsMinInput);
    tsRow.appendChild(tsMaxLabel);
    tsRow.appendChild(tsMaxInput);

    htCb.addEventListener("change", () => {
      tsRow.classList.toggle("is-hidden", !htCb.checked);
      void updateStepAntiBotField(workflow.id, index, "humanTyping", htCb.checked);
    });

    // ── Random Delays row ──
    const rdRow = document.createElement("div");
    rdRow.className = "editor-antibot-row";
    const rdLabel = document.createElement("label");
    rdLabel.className = "editor-antibot-label";
    const rdCb = document.createElement("input");
    rdCb.type = "checkbox";
    rdCb.checked = abRandomDelays;
    rdLabel.appendChild(rdCb);
    rdLabel.append(" Random Delays");
    rdRow.appendChild(rdLabel);
    rdCb.addEventListener("change", () => {
      void updateStepAntiBotField(workflow.id, index, "randomDelays", rdCb.checked);
    });

    // ── Biological Pauses row ──
    const bpRow = document.createElement("div");
    bpRow.className = "editor-antibot-row";
    const bpLabel = document.createElement("label");
    bpLabel.className = "editor-antibot-label";
    const bpCb = document.createElement("input");
    bpCb.type = "checkbox";
    bpCb.checked = abBiologicalPauses;
    bpLabel.appendChild(bpCb);
    bpLabel.append(" Biological Pauses");
    bpRow.appendChild(bpLabel);

    // Fatigue sub-row
    const fatigueRow = document.createElement("div");
    fatigueRow.className = "editor-antibot-subrow" + (abBiologicalPauses ? "" : " is-hidden");

    const fcLabel = document.createElement("label");
    fcLabel.className = "editor-antibot-field-label";
    fcLabel.textContent = "After N questions:";
    const fcInput = document.createElement("input");
    fcInput.type = "number";
    fcInput.className = "editor-antibot-field-input";
    fcInput.min = "1";
    fcInput.step = "1";
    fcInput.value = String(abFatigueCount);

    const fMinLabel = document.createElement("label");
    fMinLabel.className = "editor-antibot-field-label";
    fMinLabel.textContent = "Pause min (min):";
    const fMinInput = document.createElement("input");
    fMinInput.type = "number";
    fMinInput.className = "editor-antibot-field-input";
    fMinInput.min = "0.5";
    fMinInput.step = "0.5";
    fMinInput.value = String(abFatigueMin);

    const fMaxLabel = document.createElement("label");
    fMaxLabel.className = "editor-antibot-field-label";
    fMaxLabel.textContent = "Pause max (min):";
    const fMaxInput = document.createElement("input");
    fMaxInput.type = "number";
    fMaxInput.className = "editor-antibot-field-input";
    fMaxInput.min = "0.5";
    fMaxInput.step = "0.5";
    fMaxInput.value = String(abFatigueMax);

    function saveFatigue() {
      const count = Math.max(1, parseInt(fcInput.value || "10", 10) || 10);
      const fMin = Math.max(0.5, Number(fMinInput.value) || 0.5);
      const fMax = Math.max(fMin, Number(fMaxInput.value) || fMin);
      fcInput.value = String(count);
      fMinInput.value = String(fMin);
      fMaxInput.value = String(fMax);
      void updateStepAntiBotField(workflow.id, index, "fatigueCount", count);
      void updateStepAntiBotField(workflow.id, index, "fatigueMinMinutes", fMin);
      void updateStepAntiBotField(workflow.id, index, "fatigueMaxMinutes", fMax);
    }
    fcInput.addEventListener("change", saveFatigue);
    fMinInput.addEventListener("change", saveFatigue);
    fMaxInput.addEventListener("change", saveFatigue);

    fatigueRow.appendChild(fcLabel);
    fatigueRow.appendChild(fcInput);
    fatigueRow.appendChild(fMinLabel);
    fatigueRow.appendChild(fMinInput);
    fatigueRow.appendChild(fMaxLabel);
    fatigueRow.appendChild(fMaxInput);

    bpCb.addEventListener("change", () => {
      fatigueRow.classList.toggle("is-hidden", !bpCb.checked);
      void updateStepAntiBotField(workflow.id, index, "biologicalPauses", bpCb.checked);
    });

    antiBotSection.appendChild(htRow);
    antiBotSection.appendChild(tsRow);
    antiBotSection.appendChild(rdRow);
    antiBotSection.appendChild(bpRow);
    antiBotSection.appendChild(fatigueRow);

    antiBotToggleBtn.addEventListener("click", () => {
      const collapsed = antiBotSection.classList.toggle("is-hidden");
      antiBotToggleBtn.textContent = collapsed ? "🤖 Anti-Bot Options ▾" : "🤖 Anti-Bot Options ▴";
    });

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
    node.appendChild(contentPreview);
    node.appendChild(responseRow);
    node.appendChild(badge);
    node.appendChild(regexRow);
    node.appendChild(injectionRow);
    node.appendChild(antiBotToggle);
    node.appendChild(antiBotSection);
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
  addNode.title = "Add a new step to this workflow";
  addNode.addEventListener("click", () => {
    void handleAddStep();
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
async function handleAddStep() {
  const wf = getSelectedWorkflow();
  if (!wf) {
    alert("No workflow selected.");
    return;
  }

  // Open the modal for a new step; the step is only persisted on Save
  modalWorkflowId = wf.id;
  modalStepIndex = -1; // signals "new step"
  document.getElementById("stepModalTitle").textContent = `Add Step ${wf.steps.length + 1}`;
  document.getElementById("stepModalTitleInput").value = "";
  document.getElementById("stepModalContentInput").value = "";
  document.getElementById("stepModal").style.display = "flex";
  document.getElementById("stepModalTitleInput").focus();
}

// ─── Modal: open for existing step ────────────────────────
function openStepModal(workflowId, stepIndex) {
  const wf = workflows.find((w) => w.id === workflowId);
  if (!wf) return;
  const step = wf.steps[stepIndex];
  if (!step) return;

  modalWorkflowId = workflowId;
  modalStepIndex = stepIndex;
  document.getElementById("stepModalTitle").textContent = `Edit Step ${stepIndex + 1}`;
  document.getElementById("stepModalTitleInput").value = step.title || "";
  document.getElementById("stepModalContentInput").value = step.content || "";
  document.getElementById("stepModal").style.display = "flex";
  document.getElementById("stepModalTitleInput").focus();
}

// ─── Modal: close ─────────────────────────────────────────
function closeStepModal() {
  document.getElementById("stepModal").style.display = "none";
  modalWorkflowId = null;
  modalStepIndex = -1;
}

// ─── Modal: save ──────────────────────────────────────────
async function saveStepModal() {
  const title = document.getElementById("stepModalTitleInput").value.trim();
  const content = document.getElementById("stepModalContentInput").value;

  if (!title) {
    document.getElementById("stepModalTitleInput").focus();
    document.getElementById("stepModalTitleInput").style.borderColor = "var(--accent-red)";
    setTimeout(() => {
      document.getElementById("stepModalTitleInput").style.borderColor = "";
    }, 1500);
    return;
  }

  if (modalStepIndex === -1) {
    // New step — build defaults and add to workflow
    const defaultRegex =
      globalThis.CONFIG?.EXTRACTION?.DEFAULT_REGEX || "<extract>(.*?)</extract>";
    const defaultPlaceholder =
      globalThis.CONFIG?.EXTRACTION?.DEFAULT_PLACEHOLDER || "{{extract}}";
    const ab = globalThis.CONFIG?.ANTI_BOT || {};
    const defaultTypingSpeed = Array.isArray(ab.TYPING_SPEED_MS) ? ab.TYPING_SPEED_MS : [30, 100];
    const defaultFatiguePauseMs = Array.isArray(ab.FATIGUE_PAUSE_MS) ? ab.FATIGUE_PAUSE_MS : [20000, 40000];
    const msToMin = (ms) => Math.max(0.5, Math.round((Number(ms) / 60000) * 10) / 10);

    const newStep = {
      id: generateUUID(),
      title,
      content,
      order: (workflows.find((w) => w.id === modalWorkflowId)?.steps.length || 0),
      chainConfig: {
        responseAction: "none",
        extractionRegex: defaultRegex,
        injectionPlaceholder: defaultPlaceholder
      },
      antiBotConfig: {
        humanTyping: true,
        randomDelays: true,
        biologicalPauses: false,
        typingSpeed: [...defaultTypingSpeed],
        fatigueCount: typeof ab.FATIGUE_AFTER_QUESTIONS === "number" ? ab.FATIGUE_AFTER_QUESTIONS : 10,
        fatigueMinMinutes: msToMin(defaultFatiguePauseMs[0]),
        fatigueMaxMinutes: msToMin(defaultFatiguePauseMs[1])
      }
    };

    workflows = workflows.map((w) => {
      if (w.id !== modalWorkflowId) return w;
      return { ...w, steps: [...w.steps, newStep] };
    });
  } else {
    // Edit existing step
    workflows = workflows.map((w) => {
      if (w.id !== modalWorkflowId) return w;
      const steps = w.steps.map((s, i) => {
        if (i !== modalStepIndex) return s;
        return { ...s, title, content };
      });
      return { ...w, steps };
    });
  }

  await persist();
  closeStepModal();
  renderWorkflowSelect();
  renderCanvas();
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

async function updateStepAntiBotField(workflowId, stepIndex, field, value) {
  workflows = workflows.map((w) => {
    if (w.id !== workflowId) return w;
    const steps = w.steps.map((s, i) => {
      if (i !== stepIndex) return s;
      return { ...s, antiBotConfig: { ...s.antiBotConfig, [field]: value } };
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

  document.getElementById("editorAddStepBtn").addEventListener("click", () => void handleAddStep());

  // Modal buttons
  document.getElementById("stepModalSaveBtn").addEventListener("click", () => void saveStepModal());
  document.getElementById("stepModalCancelBtn").addEventListener("click", closeStepModal);
  document.getElementById("stepModalCloseBtn").addEventListener("click", closeStepModal);

  // Close modal on overlay click (outside the box)
  document.getElementById("stepModal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeStepModal();
  });

  // Save on Ctrl+Enter / Cmd+Enter inside modal
  document.getElementById("stepModalContentInput").addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void saveStepModal();
    }
  });
}

// ─── Init ─────────────────────────────────────────────────
async function init() {
  await load();
  renderWorkflowSelect();
  renderCanvas();
  setupEventListeners();

  // Reflect changes made from the sidepanel while this tab is open
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (!changes[WORKFLOWS_KEY]) return;
    load().then(() => {
      renderWorkflowSelect();
      renderCanvas();
    });
  });
}

document.addEventListener("DOMContentLoaded", () => void init());
