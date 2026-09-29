// jsdom'da olmayan, Radix (Popper) ve cmdk'nin cagirdigi tarayici API'leri.
// Yalniz testler icin; uygulama kodu bunlara dokunmaz.

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= NoopResizeObserver;
Element.prototype.scrollIntoView ??= function scrollIntoView() {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
