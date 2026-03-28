(function registerQuestionSubmitterModule() {
  const modules = (globalThis.ContentModules = globalThis.ContentModules || {});
  const { sleep, randomInt, randomSleep } = SharedUtils;

  function getFixedDelay(delayOrRange) {
    if (Array.isArray(delayOrRange)) {
      return Number(delayOrRange[0]) || 0;
    }

    return Number(delayOrRange) || 0;
  }

  async function waitForDelay(delayOrRange, antiBotConfig = {}) {
    if (antiBotConfig.randomDelays !== false && Array.isArray(delayOrRange)) {
      await randomSleep(delayOrRange);
      return;
    }

    await sleep(getFixedDelay(delayOrRange));
  }

  function getInputElement() {
    return (
      document.querySelector('div[contenteditable="true"]#prompt-textarea') ||
      document.querySelector('textarea#prompt-textarea, textarea[placeholder]')
    );
  }

  function isContentEditableInput(input) {
    return input?.hasAttribute("contenteditable");
  }

  function dispatchInputEvent(input, data, inputType) {
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        composed: true,
        data,
        inputType
      })
    );
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function moveCursorToEnd(input) {
    if (!isContentEditableInput(input)) {
      return;
    }

    const range = document.createRange();
    const selection = window.getSelection();
    range.selectNodeContents(input);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function getInputValue(input) {
    if (isContentEditableInput(input)) {
      return (input.textContent || "").replace(/\u00a0/g, " ");
    }

    return input.value || "";
  }

  function setInputValue(input, value, inputType = "insertText", data = value) {
    if (isContentEditableInput(input)) {
      input.innerHTML = "";
      const paragraph = document.createElement("p");
      paragraph.appendChild(document.createTextNode(value));
      input.appendChild(paragraph);
      moveCursorToEnd(input);
    } else {
      input.value = value;
      input.setSelectionRange?.(value.length, value.length);
    }

    dispatchInputEvent(input, data, inputType);
  }

  function clearInput(input) {
    if (isContentEditableInput(input)) {
      const range = document.createRange();
      const selection = window.getSelection();
      range.selectNodeContents(input);
      selection?.removeAllRanges();
      selection?.addRange(range);
      input.innerHTML = "";
      const paragraph = document.createElement("p");
      paragraph.appendChild(document.createTextNode(""));
      input.appendChild(paragraph);
    } else {
      input.value = "";
      input.setSelectionRange?.(0, 0);
    }

    dispatchInputEvent(input, "", "deleteContentBackward");
  }

  function createKeyboardEvent(type, key, code, keyCode) {
    return new KeyboardEvent(type, {
      key,
      code,
      keyCode,
      which: keyCode,
      bubbles: true,
      cancelable: true,
      composed: true
    });
  }

  function appendCharacter(input, character) {
    const nextValue = `${getInputValue(input)}${character}`;
    setInputValue(input, nextValue, "insertText", character);
  }

  function removeLastCharacter(input) {
    const currentValue = getInputValue(input);
    setInputValue(input, currentValue.slice(0, -1), "deleteContentBackward", null);
  }

  async function typeCharacter(input, character, antiBotConfig) {
    const keyCode = character === "\n" ? 13 : character.toUpperCase().charCodeAt(0);
    const code = character === " " ? "Space" : `Key${character.toUpperCase()}`;

    input.dispatchEvent(createKeyboardEvent("keydown", character, code, keyCode || 0));
    input.dispatchEvent(createKeyboardEvent("keypress", character, code, keyCode || 0));
    appendCharacter(input, character);
    input.dispatchEvent(createKeyboardEvent("keyup", character, code, keyCode || 0));

    await waitForDelay(
      antiBotConfig.typingSpeed || CONFIG.ANTI_BOT.TYPING_SPEED_MS,
      antiBotConfig
    );
  }

  async function pressBackspace(input, antiBotConfig) {
    input.dispatchEvent(createKeyboardEvent("keydown", "Backspace", "Backspace", 8));
    removeLastCharacter(input);
    input.dispatchEvent(createKeyboardEvent("keyup", "Backspace", "Backspace", 8));
    await waitForDelay([60, 140], antiBotConfig);
  }

  function getMistypedCharacter(character) {
    if (!/[a-z0-9]/i.test(character)) {
      return "e";
    }

    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    let candidate = character.toLowerCase();

    while (candidate === character.toLowerCase()) {
      candidate = alphabet[randomInt(0, alphabet.length - 1)];
    }

    return character === character.toUpperCase() ? candidate.toUpperCase() : candidate;
  }

  async function humanTypeQuestion(input, question, antiBotConfig) {
    clearInput(input);

    for (const character of question) {
      if (Math.random() < (antiBotConfig.errorProbability ?? CONFIG.ANTI_BOT.ERROR_PROBABILITY)) {
        await typeCharacter(input, getMistypedCharacter(character), antiBotConfig);
        await waitForDelay([80, 180], antiBotConfig);
        await pressBackspace(input, antiBotConfig);
      }

      await typeCharacter(input, character, antiBotConfig);

      if (Math.random() < 0.05) {
        await waitForDelay([180, 420], antiBotConfig);
      }
    }
  }

  function directInputQuestion(input, question) {
    clearInput(input);
    setInputValue(input, question, "insertText", question);
  }

  function basicClickElement(element) {
    try {
      element.click();
      return true;
    } catch {
    }

    try {
      element.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window })
      );
      element.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window })
      );
      element.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
      );
      return true;
    } catch {
    }

    try {
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
      element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }));
      element.click();
      return true;
    } catch {
    }

    return false;
  }

  function getRandomPoint(rect) {
    const horizontalPadding = Math.max(4, rect.width * 0.18);
    const verticalPadding = Math.max(4, rect.height * 0.22);

    return {
      clientX: randomInt(rect.left + horizontalPadding, rect.right - horizontalPadding),
      clientY: randomInt(rect.top + verticalPadding, rect.bottom - verticalPadding)
    };
  }

  async function clickElement(element, antiBotConfig = {}) {
    if (!element) {
      return false;
    }

    try {
      element.scrollIntoView({ behavior: "instant", block: "center" });
    } catch {
    }

    if (!antiBotConfig.humanTyping && antiBotConfig.randomDelays === false) {
      return basicClickElement(element);
    }

    try {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return basicClickElement(element);
      }

      const { clientX, clientY } = getRandomPoint(rect);
      element.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX,
          clientY
        })
      );
      await waitForDelay([50, 100], antiBotConfig);
      element.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX,
          clientY,
          button: 0
        })
      );
      await waitForDelay([20, 80], antiBotConfig);
      element.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX,
          clientY,
          button: 0
        })
      );
      element.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX,
          clientY,
          button: 0
        })
      );
      return true;
    } catch {
      return basicClickElement(element);
    }
  }

  async function inputQuestion(question, antiBotConfig = {}) {
    try {
      const input = getInputElement();
      if (!input) {
        throw new Error("Input element not found");
      }

      input.focus();
      await waitForDelay(CONFIG.TIMING.INPUT_WAIT_MS, antiBotConfig);

      if (antiBotConfig.humanTyping !== false) {
        await humanTypeQuestion(input, question, antiBotConfig);
      } else {
        directInputQuestion(input, question);
      }

      await waitForDelay(CONFIG.TIMING.SUBMIT_WAIT_MS, antiBotConfig);
      return true;
    } catch {
      return false;
    }
  }

  async function submitQuestion(antiBotConfig = {}) {
    try {
      await waitForDelay(CONFIG.TIMING.SUBMIT_WAIT_MS, antiBotConfig);

      const contentEditable = document.querySelector('div[contenteditable="true"]#prompt-textarea');
      if (contentEditable) {
        contentEditable.focus();
        await waitForDelay([120, 260], antiBotConfig);
        contentEditable.dispatchEvent(createKeyboardEvent("keydown", "Enter", "Enter", 13));
        contentEditable.dispatchEvent(createKeyboardEvent("keypress", "Enter", "Enter", 13));
        contentEditable.dispatchEvent(createKeyboardEvent("keyup", "Enter", "Enter", 13));
        await waitForDelay([700, 1200], antiBotConfig);
        return true;
      }

      let sendButton = document.querySelector("button#composer-submit-button");
      if (!sendButton) {
        sendButton = document.querySelector('button[data-testid="send-button"]');
      }
      if (!sendButton) {
        sendButton = document.querySelector('button[aria-label*="发送"], button[aria-label*="Send"]');
      }
      if (!sendButton) {
        return true;
      }

      if (sendButton.disabled) {
        for (let attempt = 0; attempt < 10 && sendButton.disabled; attempt += 1) {
          await waitForDelay(CONFIG.TIMING.SUBMIT_WAIT_MS, antiBotConfig);
        }
      }

      if (!sendButton.disabled) {
        await clickElement(sendButton, antiBotConfig);
      }

      await waitForDelay([700, 1200], antiBotConfig);
      return true;
    } catch {
      return false;
    }
  }

  Object.assign(modules, {
    inputQuestion,
    submitQuestion
  });
})();