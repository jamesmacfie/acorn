// Node 24 defines a process-level `localStorage` property, but leaves its value undefined unless the
// process receives `--localstorage-file`. Vitest therefore skips jsdom's property while populating
// the global object. Take the store from Vitest's jsdom handle after the environment starts, so each
// worker keeps browser-compatible, isolated storage without a shared process-level file.
const storage = (globalThis as typeof globalThis & { jsdom: { window: Window } }).jsdom.window.localStorage

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: storage,
})
