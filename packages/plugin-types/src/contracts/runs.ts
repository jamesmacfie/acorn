// ── Runs ──────────────────────────────────────────────────────────────────────────────────────────

/** Where your plugin's runs can be read from the node, for the merged run list core assembles.
 *
 * Register one if your plugin owns work that starts, takes time, and ends — a workflow run, an agent
 * session, a build. You keep your own table, your own lifecycle and your own surfaces; this is a
 * pointer at a `GET` route inside your own namespace that answers `{ runs }`, and the host merges it
 * with every other plugin's without either of you knowing the other exists.
 *
 * The route is called with no client attached and no request in sight, so it takes no params and
 * answers node-wide. Core applies the caller's confinement to the merged answer. Answer with what is
 * happening now rather than your whole history: the list is a "what is running" surface, and a caller
 * that wants one run's detail comes back to your own routes addressing it by id. */
export type PluginRunRegistry = {
  register(source: { runs: string }): void
}

