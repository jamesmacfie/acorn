// The loadable-package declaration for this plugin: what `apps/node/scripts/build-plugin.mjs` reads
// to build the bundles and generate `acorn-plugin.json`. It lives here, not in the build script, so
// the plugin's declared surface is visible from the plugin's own directory, which is where an author
// looks first and where a reviewer diffs it.
//
// `id: "sentry-telemetry"` is the directory name, and it is deliberately not `sentry`. That id is
// reserved for the integration that reads Sentry issues into the rail, which has the Rollbar shape:
// an organisation token, mirrored items, a pane and a source. This one has a DSN and writes. Two
// plugins, two credentials, two reasons to install, and both carry the Sentry mark in Settings
// (docs/integrations.md § Sentry).
//
// On the permissions:
//
//   core: ['telemetry'] — the read-everything grant, and the reason the trust prompt draws this
//     plugin high. A sink sees every record from every owner: core's request timings, another
//     plugin's schedule runs, and the log lines of packages the owner installed for a different
//     reason (docs/security.md § Telemetry sinks). It is also the entire feature.
//   core: ['prefs'] — the settings page below writes `plugin:sentry-telemetry:settings` through
//     `bridge.state`, and the node half reads the same row on each flush to learn the sample rate
//     and which kinds to send. Scoped to this plugin's own namespace by the host.
//   core: ['identity'] — a flush has no HTTP request to take an owner from, and both the connection
//     and the preference are per-owner rows. Same reason plugins/http declares it for its workflow
//     step.
//   secrets: false — the Rollbar and Linear posture. The provider spends the DSN through the
//     connection seam, which resolves the `integrations` row inside core's own secret scope and
//     lends the plaintext for the length of one call. `ctx.core.secrets` is never touched, so
//     claiming it would overstate.
//   exec: false — nothing here spawns anything.
//   net — disclosure rather than enforcement, and the honest thing to say is a pattern. A DSN names
//     its own host, so `o<org>.ingest.<region>.sentry.io` is where a sentry.io project lives and a
//     self-hosted install is wherever the owner runs it.
export default {
  name: 'Sentry (telemetry export)',
  // The Sentry mark, as one SVG path's `d` in a 24 box. The host validates the grammar and registers
  // it as `brand:sentry-telemetry` under the id it stamps from this package's directory, so
  // `glyph: 'brand:sentry-telemetry'` in src/server/provider.ts resolves with no client code of ours
  // drawing it. From simple-icons (CC0 artwork; the trademark remains Sentry's).
  icon: { color: '#362d59', d: 'M13.91 2.505c-.873-1.448-2.972-1.448-3.844 0L6.904 7.92a15.478 15.478 0 0 1 8.53 12.811h-2.221A13.301 13.301 0 0 0 5.784 9.814l-2.926 5.06a7.65 7.65 0 0 1 4.435 5.848H2.194a.365.365 0 0 1-.298-.534l1.413-2.402a5.16 5.16 0 0 0-1.614-.913L.296 19.275a2.182 2.182 0 0 0 .812 2.999 2.24 2.24 0 0 0 1.086.288h6.983a9.322 9.322 0 0 0-3.845-8.318l1.11-1.922a11.47 11.47 0 0 1 4.95 10.24h5.915a17.242 17.242 0 0 0-7.885-15.28l2.244-3.845a.37.37 0 0 1 .504-.13c.255.14 9.75 16.708 9.928 16.9a.365.365 0 0 1-.327.543h-2.287c.029.612.029 1.223 0 1.831h2.297a2.206 2.206 0 0 0 1.922-3.31z' },
  entry: '@acorn/plugin-sentry-telemetry/node/index.ts',
  factory: 'sentryTelemetryPlugin',
  client: {
    entry: './src/tree/index.tsx',
  },
  permissions: {
    // The settings page reads and writes nothing of core's over the bridge. It draws four controls
    // backed by `state.get` and `state.set`, which need no scope: a plugin's own state always is.
    api: [],
    events: [],
    node: { core: ['telemetry', 'prefs', 'identity'], capabilities: [], secrets: false, exec: false, net: ['*.ingest.sentry.io', '*.ingest.us.sentry.io', '*.ingest.de.sentry.io', 'sentry.io'] },
  },
  contributions: {
    // One surface. There is no pane and no rail source, because this plugin shows nothing: what it
    // collected is in Sentry, and what this node collected is already on Settings → Telemetry.
    frames: [{
      target: 'settings',
      id: 'sentry-telemetry',
      label: 'Sentry export',
      glyph: 'brand:sentry-telemetry',
      group: 'general',
      order: 68,
      // One tree fills the page, so the layout is the trivial one. Naming it is still what says
      // "draw this from my tree" rather than "give me a rectangle", and it is what the surface
      // inherits its focus group and padding from (docs/panes.md § Layout model).
      layout: 'single',
      regions: { body: { kind: 'remote', entry: 'settings' } },
    }],
  },
}
