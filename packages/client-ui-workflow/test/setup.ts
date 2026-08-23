import "@testing-library/jest-dom/vitest";

// Mock ResizeObserver with instant callback
class MockResizeObserver {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe(target: Element) {
    this.cb(
      [
        {
          target,
          contentRect: {
            x: 0,
            y: 0,
            width: 200,
            height: 90,
            top: 0,
            left: 0,
            bottom: 90,
            right: 200,
            toJSON: () => {},
          },
          borderBoxSize: [{ inlineSize: 200, blockSize: 90 }],
          contentBoxSize: [{ inlineSize: 200, blockSize: 90 }],
          devicePixelContentBoxSize: [],
        } as unknown as ResizeObserverEntry,
      ],
      this
    );
  }
  unobserve() {}
  disconnect() {}
}

global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

// Polyfill DOM dimensions for jsdom
if (typeof window !== "undefined") {
  Object.defineProperties(HTMLElement.prototype, {
    offsetWidth: {
      get() {
        if (this.classList && this.classList.contains("react-flow__handle")) return 8;
        return 200;
      },
    },
    offsetHeight: {
      get() {
        if (this.classList && this.classList.contains("react-flow__handle")) return 8;
        return 90;
      },
    },
    offsetLeft: {
      get() {
        return 0;
      },
    },
    offsetTop: {
      get() {
        return 0;
      },
    },
    clientWidth: {
      get() {
        if (this.classList && this.classList.contains("react-flow__handle")) return 8;
        return 200;
      },
    },
    clientHeight: {
      get() {
        if (this.classList && this.classList.contains("react-flow__handle")) return 8;
        return 90;
      },
    },
  });

  Element.prototype.getBoundingClientRect = function () {
    const isHandle = this.classList && this.classList.contains("react-flow__handle");
    if (isHandle) {
      const isTop = this.getAttribute("data-handlepos") === "top";
      return {
        width: 8,
        height: 8,
        top: isTop ? 0 : 90,
        left: 96,
        bottom: isTop ? 8 : 98,
        right: 104,
        x: 96,
        y: isTop ? 0 : 90,
        toJSON: () => {},
      };
    }
    return {
      width: 200,
      height: 90,
      top: 0,
      left: 0,
      bottom: 90,
      right: 200,
      x: 0,
      y: 0,
      toJSON: () => {},
    };
  };
}
