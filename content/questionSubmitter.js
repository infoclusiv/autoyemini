(function registerQuestionSubmitterModule() {
  const modules = (globalThis.ContentModules = globalThis.ContentModules || {});
  const { randomInt } = SharedUtils;

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

    await modules.waitForDelay(
      antiBotConfig.typingSpeed || CONFIG.ANTI_BOT.TYPING_SPEED_MS,
      antiBotConfig
    );
  }

  async function pressBackspace(input, antiBotConfig) {
    input.dispatchEvent(createKeyboardEvent("keydown", "Backspace", "Backspace", 8));
    removeLastCharacter(input);
    input.dispatchEvent(createKeyboardEvent("keyup", "Backspace", "Backspace", 8));
    await modules.waitForDelay([60, 140], antiBotConfig);
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
        await modules.waitForDelay([80, 180], antiBotConfig);
        await pressBackspace(input, antiBotConfig);
      }

      await typeCharacter(input, character, antiBotConfig);

      if (Math.random() < 0.05) {
        await modules.waitForDelay([180, 420], antiBotConfig);
      }
    }
  }

  function directInputQuestion(input, question) {
    clearInput(input);
    setInputValue(input, question, "insertText", question);
  }

  async function inputQuestion(question, antiBotConfig = {}) {
    try {
      const input = getInputElement();
      if (!input) {
        throw new Error("Input element not found");
      }

      input.focus();
      await modules.waitForDelay(CONFIG.TIMING.INPUT_WAIT_MS, antiBotConfig);

      if (antiBotConfig.humanTyping === true) {
        await humanTypeQuestion(input, question, antiBotConfig);
      } else {
        directInputQuestion(input, question);
      }

      await modules.waitForDelay(CONFIG.TIMING.SUBMIT_WAIT_MS, antiBotConfig);
      return true;
    } catch {
      return false;
    }
  }

  async function submitQuestion(antiBotConfig = {}) {
    try {
      await modules.waitForDelay(CONFIG.TIMING.SUBMIT_WAIT_MS, antiBotConfig);

      const contentEditable = document.querySelector('div[contenteditable="true"]#prompt-textarea');
      if (contentEditable) {
        contentEditable.focus();
        await modules.waitForDelay([120, 260], antiBotConfig);
        contentEditable.dispatchEvent(createKeyboardEvent("keydown", "Enter", "Enter", 13));
        contentEditable.dispatchEvent(createKeyboardEvent("keypress", "Enter", "Enter", 13));
        contentEditable.dispatchEvent(createKeyboardEvent("keyup", "Enter", "Enter", 13));
        await modules.waitForDelay([700, 1200], antiBotConfig);
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
          await modules.waitForDelay(CONFIG.TIMING.SUBMIT_WAIT_MS, antiBotConfig);
        }
      }

      if (!sendButton.disabled) {
        await modules.clickElement(sendButton, antiBotConfig);
      }

      await modules.waitForDelay([700, 1200], antiBotConfig);
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