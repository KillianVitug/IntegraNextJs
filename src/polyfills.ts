import ResizeObserverPolyfill from "resize-observer-polyfill";

type QueueMicrotaskCallback = () => void;
type CssEscapeGlobal = {
  CSS?: {
    escape?: (value: string) => string;
  };
};

function installResizeObserver() {
  if (
    typeof window !== "undefined" &&
    typeof window.ResizeObserver === "undefined"
  ) {
    window.ResizeObserver = ResizeObserverPolyfill;
  }
}

function installQueueMicrotask() {
  if (
    typeof window !== "undefined" &&
    typeof window.queueMicrotask !== "function"
  ) {
    window.queueMicrotask = function queueMicrotask(
      callback: QueueMicrotaskCallback,
    ): void {
      Promise.resolve()
        .then(callback)
        .catch((error) =>
          setTimeout(() => {
            throw error;
          }, 0),
        );
    };
  }
}

function installCssEscape() {
  if (typeof window === "undefined") return;

  const browserWindow = window as Window & CssEscapeGlobal;

  if (typeof browserWindow.CSS === "undefined") {
    browserWindow.CSS = {};
  }

  if (typeof browserWindow.CSS.escape === "function") return;

  browserWindow.CSS.escape = function cssEscape(value: string): string {
    const string = String(value);
    const length = string.length;
    let index = -1;
    let output = "";
    const firstCodeUnit = string.charCodeAt(0);

    while (++index < length) {
      const codeUnit = string.charCodeAt(index);

      if (codeUnit === 0x0000) {
        output += "\uFFFD";
        continue;
      }

      if (
        (codeUnit >= 0x0001 && codeUnit <= 0x001f) ||
        codeUnit === 0x007f ||
        (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
        (index === 1 &&
          codeUnit >= 0x0030 &&
          codeUnit <= 0x0039 &&
          firstCodeUnit === 0x002d)
      ) {
        output += `\\${codeUnit.toString(16)} `;
        continue;
      }

      if (index === 0 && codeUnit === 0x002d && length === 1) {
        output += `\\${string.charAt(index)}`;
        continue;
      }

      if (
        codeUnit >= 0x0080 ||
        codeUnit === 0x002d ||
        codeUnit === 0x005f ||
        (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
        (codeUnit >= 0x0041 && codeUnit <= 0x005a) ||
        (codeUnit >= 0x0061 && codeUnit <= 0x007a)
      ) {
        output += string.charAt(index);
        continue;
      }

      output += `\\${string.charAt(index)}`;
    }

    return output;
  };
}

installResizeObserver();
installQueueMicrotask();
installCssEscape();
