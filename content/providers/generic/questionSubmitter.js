(function registerGenericSubmitterModule() {
  const modules = (globalThis.ContentModules = globalThis.ContentModules || {});

  function getProviderSelectors() {
    return window.__PROVIDER_CONFIG__?.selectors || {};
  }

  function getInputElement() {
    const selectors = getProviderSelectors();
    const configuredSelectors = [
      selectors.input,
      selectors.inputFallback1,
      selectors.inputFallback2
    ].filter(Boolean);

    for (const selector of configuredSelectors) {
      try {
        const element = document.querySelector(selector);
        if (element && element.offsetParent !== null) {
          return element;
        }
      } catch {
      }
    }

    const fallbackSelectors = [
      "[contenteditable='true']:not([aria-hidden='true'])",
      "textarea:not([hidden]):not([disabled]):not([aria-hidden='true'])"
    ];

    for (const selector of fallbackSelectors) {
      try {
        const element = document.querySelector(selector);
        if (element && element.offsetParent !== null) {
          return element;
        }
      } catch {
      }
    }

    return null;
  }

  function getSubmitButton() {
    const selectors = getProviderSelectors();
    const configuredSelectors = [
      selectors.submitButton,
      selectors.submitButtonFallback
    ].filter(Boolean);

    for (const selector of configuredSelectors) {
      try {
        const element = document.querySelector(selector);
        if (element && !element.disabled) {
          return element;
        }
      } catch {
      }
    }

    return null;
  }

  async function inputQuestion(question, antiBotConfig = {}) {
    try {
      const input = getInputElement();
      if (!input) {
        const selectors = getProviderSelectors();
        throw new Error(
          `Generic provider: input not found. Configured selector: "${selectors.input || "none"}".`
        );
      }

      input.focus();
      await modules.waitForDelay(CONFIG.TIMING.INPUT_WAIT_MS, antiBotConfig);

      if (input.hasAttribute("contenteditable")) {
        input.innerHTML = "";
        const paragraph = document.createElement("p");
        paragraph.textContent = question;
        input.appendChild(paragraph);

        const range = document.createRange();
        const selection = window.getSelection();
        range.selectNodeContents(input);
        range.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(range);
      } else {
        input.value = question;
        input.setSelectionRange?.(question.length, question.length);
      }

      input.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: question
      }));
      input.dispatchEvent(new Event("change", { bubbles: true }));

      await modules.waitForDelay(CONFIG.TIMING.SUBMIT_WAIT_MS, antiBotConfig);
      return true;
    } catch (error) {
      console.error("[generic/questionSubmitter] inputQuestion:", error.message);
      return false;
    }
  }

  async function submitQuestion(antiBotConfig = {}) {
    try {
      await modules.waitForDelay(CONFIG.TIMING.SUBMIT_WAIT_MS, antiBotConfig);

      const selectors = getProviderSelectors();
      const submitMethod = selectors.submitMethod || "enter";
      const input = getInputElement();

      if (submitMethod === "ctrl_enter" && input) {
        input.focus();
        input.dispatchEvent(new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          ctrlKey: true,
          bubbles: true,
          cancelable: true
        }));
        await modules.waitForDelay([500, 800], antiBotConfig);
        return true;
      }

      if (submitMethod === "button" || !input) {
        const button = getSubmitButton();
        if (button) {
          await modules.clickElement(button, antiBotConfig);
          await modules.waitForDelay([700, 1200], antiBotConfig);
          return true;
        }
      }

      if (input) {
        input.focus();
        input.dispatchEvent(new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          bubbles: true,
          cancelable: true
        }));
        await modules.waitForDelay([700, 1200], antiBotConfig);
        return true;
      }

      return false;
    } catch (error) {
      console.error("[generic/questionSubmitter] submitQuestion:", error.message);
      return false;
    }
  }

  Object.assign(modules, { inputQuestion, submitQuestion });
})();