(function registerWebSearchModule() {
  const modules = (globalThis.ContentModules = globalThis.ContentModules || {});
  const { sleep } = SharedUtils;

  function findSearchMenuItem(menu) {
    const menuItems = Array.from(menu.querySelectorAll(".__menu-item"));
    const iconMatch = menuItems.find((item) => {
      const path = item.querySelector("svg path");
      const value = path?.getAttribute("d");
      return value && (value.startsWith("M10 2.125C14.3492") || value.includes("17.875 10C17.875 14.3492"));
    });
    if (iconMatch) {
      return iconMatch;
    }

    const groups = menu.querySelectorAll('[role="group"]');
    if (groups.length >= 2) {
      const fallbackItems = Array.from(groups[1].querySelectorAll(".__menu-item")).filter((item) => {
        const hasSvg = item.querySelector("svg") !== null;
        const hasImage = item.querySelector("img") !== null;
        const text = item.textContent.trim();
        return hasSvg && !hasImage && text.length <= 10;
      });

      if (fallbackItems.length > 0) {
        return fallbackItems[fallbackItems.length - 1];
      }
    }

    return (
      menuItems.find((item) => {
        const text = item.textContent.trim();
        const lowered = text.toLowerCase();
        if (
          [
            "Search",
            "Web Search",
            "Suche",
            "Recherche",
            "Recherche Web",
            "Buscar",
            "Busqueda Web",
            "搜索",
            "搜尋",
            "网页搜索",
            "網頁搜尋",
            "検索",
            "ウェブ検索",
            "검색",
            "웹 검색",
            "Поиск",
            "Веб-поиск"
          ].includes(text)
        ) {
          return true;
        }

        if (text.length <= 10) {
          if (text.startsWith("搜索") && !text.includes("聊天") && !text.includes("对话")) {
            return true;
          }
          if (text.startsWith("搜尋") && !text.includes("聊天") && !text.includes("對話")) {
            return true;
          }
          if (lowered.startsWith("search") && !lowered.includes("chat") && !lowered.includes("conversation")) {
            return true;
          }
        }

        return false;
      }) || null
    );
  }

  async function clickWithEvents(element) {
    const rect = element.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;

    element.dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window, clientX, clientY })
    );
    await sleep(50);
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
    await sleep(50);
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
    await sleep(50);
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
    element.click();
  }

  async function enableWebSearchViaSlash() {
    try {
      const input = document.querySelector('div[contenteditable="true"]#prompt-textarea, textarea#prompt-textarea');
      if (!input) {
        return false;
      }

      input.focus();
      await sleep(CONFIG.TIMING.SUBMIT_WAIT_MS);
      input.innerHTML = "";
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "/",
          code: "Slash",
          keyCode: 191,
          which: 191,
          bubbles: true,
          cancelable: true
        })
      );
      input.innerHTML = "/";

      const range = document.createRange();
      const selection = window.getSelection();
      if (input.childNodes.length > 0) {
        range.setStart(input.childNodes[0], 1);
        range.collapse(true);
      } else {
        range.selectNodeContents(input);
        range.collapse(false);
      }
      selection.removeAllRanges();
      selection.addRange(range);

      input.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: "/"
        })
      );
      input.dispatchEvent(
        new KeyboardEvent("keyup", {
          key: "/",
          code: "Slash",
          keyCode: 191,
          which: 191,
          bubbles: true,
          cancelable: true
        })
      );

      await sleep(CONFIG.TIMING.MENU_APPEAR_WAIT_MS);

      const overlays = document.querySelectorAll('div[style*="position: absolute"], div[style*="position: fixed"]');
      let menu = null;

      for (const overlay of overlays) {
        const items = overlay.querySelectorAll(".__menu-item");
        if (items.length > 0 && items.length < 20) {
          const hasSearchIcon = Array.from(overlay.querySelectorAll("svg path")).some((path) => {
            const value = path.getAttribute("d");
            return value && (value.startsWith("M10 2.125C14.3492") || value.includes("17.875 10C17.875 14.3492"));
          });
          if (hasSearchIcon) {
            menu = overlay;
            break;
          }
        }
      }

      if (!menu) {
        for (const overlay of overlays) {
          const items = overlay.querySelectorAll(".__menu-item");
          const groups = overlay.querySelectorAll('[role="group"]');
          if (items.length >= 3 && items.length <= 15 && groups.length >= 1 && groups.length <= 4) {
            menu = overlay;
            break;
          }
        }
      }

      if (!menu) {
        input.innerHTML = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return false;
      }

      const menuItem = findSearchMenuItem(menu);
      if (!menuItem) {
        input.innerHTML = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return false;
      }

      await clickWithEvents(menuItem);
      await sleep(CONFIG.TIMING.INPUT_WAIT_MS);
      input.innerHTML = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    } catch {
      return false;
    }
  }

  async function enableWebSearch() {
    try {
      const selectedButtons = document.querySelectorAll('button[data-is-selected="true"]');
      for (const button of selectedButtons) {
        const label = button.textContent || "";
        if (label.includes("搜索") || label.toLowerCase().includes("search")) {
          return true;
        }
      }

      return enableWebSearchViaSlash();
    } catch {
      return false;
    }
  }

  Object.assign(modules, {
    enableWebSearch
  });
})();