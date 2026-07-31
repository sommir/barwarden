if (!("IntersectionObserver" in globalThis)) {
  class TestIntersectionObserver {
    disconnect = (): void => {};
    observe = (): void => {};
    takeRecords = (): IntersectionObserverEntry[] => [];
    unobserve = (): void => {};
    readonly root = null;
    readonly rootMargin = "0px";
    readonly thresholds = [0];
  }

  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    value: TestIntersectionObserver,
    writable: true,
  });
}

Object.defineProperty(globalThis.navigator, "language", {
  configurable: true,
  value: "zh-CN",
});
