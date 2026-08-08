// The four globals the real client plugin list needs to be IMPORTED and initialized in a bare-Node
// vitest run. Not a DOM: nothing in this project renders a component.
//
//   1. `window.document.addEventListener` — Solid's `delegateEvents(names, document = window.document)`
//      runs at module scope in every compiled `.tsx`, so the import itself throws without it.
//   2. `window.history` — @solidjs/router reads `history.state` at module scope to seed its depth
//      counter. Plugins reach the router through @acorn/plugin-api/ui, whose barrel evaluates every
//      component on it, so this is now on the import path of any plugin with a UI at all.
//   3. `localStorage` — plugins/http's draft purge enumerates it.
//   4. `fetch` — plugins/agents primes its managed-session roster over HTTP.
//
// (3) and (4) are only needed for the `activate` phase; `init` must work without them, and
// clientPluginDisable.test.ts asserts exactly that by deleting them around an init-only pass.

const listeners = { addEventListener: () => {}, removeEventListener: () => {} }

// Enough of the History API for the router's module-scope seeding: it reads `state`, and writes one
// back when the depth marker is missing. Nothing in this project navigates.
let historyState: unknown = null
const historyStub = {
  get state() {
    return historyState
  },
  replaceState: (state: unknown) => void (historyState = state),
  pushState: (state: unknown) => void (historyState = state),
}

const store = new Map<string, string>()
const localStorageStub: Storage = {
  get length() {
    return store.size
  },
  key: (index: number) => [...store.keys()][index] ?? null,
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, String(value)),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
}

// `as unknown as` rather than a structural cast: these are the only members reached, and pretending to
// satisfy the full lib.dom types would mean stubbing dozens of properties nothing calls.
Object.assign(globalThis, {
  window: { document: listeners, addEventListener: listeners.addEventListener, history: historyStub },
  document: listeners,
  localStorage: localStorageStub,
  // Every plugin read is a GET returning JSON. One shape covers the roster prime; anything else that
  // starts fetching at activation should fail this file's expectations rather than silently pass.
  fetch: async () =>
    new Response(JSON.stringify({ sessions: [], providers: [], integrations: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
} as unknown as Record<string, unknown>)
