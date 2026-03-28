(function registerQuestionSubmitterModule() {
  const modules = (globalThis.ContentModules = globalThis.ContentModules || {});
  const { sleep } = SharedUtils;

  function clickElement(element) {
    if (!element) {
      return false;
    }

    try {
      element.scrollIntoView({ behavior: "instant", block: "center" });
    } catch {
    }

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

  async function inputQuestion(question) {
    try {
      let input = document.querySelector('div[contenteditable="true"]#prompt-textarea');
      if (!input) {
        input = document.querySelector('textarea#prompt-textarea, textarea[placeholder]');
      }
      if (!input) {
        throw new Error("Input element not found");
      }

      input.focus();
      await sleep(CONFIG.TIMING.INPUT_WAIT_MS);

      if (input.hasAttribute("contenteditable")) {
        input.innerHTML = "";
        const paragraph = document.createElement("p");
        paragraph.appendChild(document.createTextNode(question));
        input.appendChild(paragraph);
        input.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            cancelable: true,
            composed: true,
            data: question
          })
        );
      } else {
        input.value = question;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }

      await sleep(CONFIG.TIMING.SUBMIT_WAIT_MS);
      return true;
    } catch {
      return false;
    }
  }

  async function submitQuestion() {
    try {
      await sleep(CONFIG.TIMING.SUBMIT_WAIT_MS);

      const contentEditable = document.querySelector('div[contenteditable="true"]#prompt-textarea');
      if (contentEditable) {
        contentEditable.focus();
        await sleep(200);
        contentEditable.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
            composed: true
          })
        );
        contentEditable.dispatchEvent(
          new KeyboardEvent("keypress", {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
            composed: true
          })
        );
        await sleep(1000);
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
          await sleep(CONFIG.TIMING.SUBMIT_WAIT_MS);
        }
      }

      if (!sendButton.disabled) {
        clickElement(sendButton);
      }

      await sleep(1000);
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