/** The phone build's sandbox domain, with its port when it has one. Unset everywhere else. */
declare const __ACORN_SANDBOX_DOMAIN__: string | null | undefined

/** Where the phone's plugin code runs (docs/mobile/plugin-sandbox.md). A module of its own, so the phone's
 *  first screen can ask whether it has one without loading the tree host. */
export const sandboxDomain = (): string | null =>
  typeof __ACORN_SANDBOX_DOMAIN__ === 'string' ? __ACORN_SANDBOX_DOMAIN__ : null
