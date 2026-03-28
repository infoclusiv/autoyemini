(function registerDomInteractionModule() {
  const modules = (globalThis.ContentModules = globalThis.ContentModules || {});
  const { randomInt, getFixedDelay } = SharedUtils;

  function waitForDelay(delayOrRange, antiBotConfig = {}) {
    return SharedUtils.waitForDelay(delayOrRange, antiBotConfig.randomDelays !== false);
  }

  function getRandomPoint(rect) {
    const horizontalPadding = Math.max(4, rect.width * 0.18);
    const verticalPadding = Math.max(4, rect.height * 0.22);

    return {
      clientX: randomInt(rect.left + horizontalPadding, rect.right - horizontalPadding),
      clientY: randomInt(rect.top + verticalPadding, rect.bottom - verticalPadding)
    };
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
        new MouseEvent("mouseover", {
          bubbles: true, cancelable: true, view: window, clientX, clientY
        })
      );
      element.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true, cancelable: true, view: window, clientX, clientY
        })
      );
      await waitForDelay([50, 100], antiBotConfig);
      element.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0
        })
      );
      await waitForDelay([20, 80], antiBotConfig);
      element.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0
        })
      );
      await waitForDelay([20, 60], antiBotConfig);
      element.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0
        })
      );
      return true;
    } catch {
      return basicClickElement(element);
    }
  }

  Object.assign(modules, {
    getFixedDelay,
    waitForDelay,
    getRandomPoint,
    basicClickElement,
    clickElement
  });
})();
