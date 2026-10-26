// The loadable-package declaration for this plugin: what `apps/node/scripts/build-plugin.mjs` reads
// to build the bundles and generate `acorn-plugin.json`. It lives here so the plugin's declared
// surface is visible from the plugin's own directory, which is where an author looks first and where
// a reviewer diffs it.
//
// This plugin reads issues with an auth token. `sentry-telemetry` sends with a DSN. They stay two
// plugins because one holding both would ask for the wider credential to do the narrower job
// (docs/integrations/sentry.md § Sentry).
//
// On the permissions:
//
//   core: ['projects:read'] — the rail reads which Sentry connections the routed project's workspace
//     follows, as Rollbar's does.
//   secrets: false — the provider spends the owner's token through the connection seam, which lends
//     it for the length of one call. `ctx.core.secrets` is never touched.
//   net — Sentry's API hosts: the US region at sentry.io and us.sentry.io, the EU region at
//     de.sentry.io. A connection or `ACORN_SENTRY_URL` naming any other host is refused up front, so
//     it fails with a reason instead of a blocked request.
//   env — a developer's credentials, used when no connection exists, so their node shows issues with
//     no Settings step. The token reads the organization's issues, so it is never logged.
export default {
  name: 'Sentry',
  // The Sentry mark, as one SVG path's `d` in a 24 box, the same mark sentry-telemetry carries. The
  // host registers it as `brand:sentry`. From simple-icons (CC0 artwork; the trademark remains
  // Sentry's).
  icon: { color: '#362d59', d: 'M13.91 2.505c-.873-1.448-2.972-1.448-3.844 0L6.904 7.92a15.478 15.478 0 0 1 8.53 12.811h-2.221A13.301 13.301 0 0 0 5.784 9.814l-2.926 5.06a7.65 7.65 0 0 1 4.435 5.848H2.194a.365.365 0 0 1-.298-.534l1.413-2.402a5.16 5.16 0 0 0-1.614-.913L.296 19.275a2.182 2.182 0 0 0 .812 2.999 2.24 2.24 0 0 0 1.086.288h6.983a9.322 9.322 0 0 0-3.845-8.318l1.11-1.922a11.47 11.47 0 0 1 4.95 10.24h5.915a17.242 17.242 0 0 0-7.885-15.28l2.244-3.845a.37.37 0 0 1 .504-.13c.255.14 9.75 16.708 9.928 16.9a.365.365 0 0 1-.327.543h-2.287c.029.612.029 1.223 0 1.831h2.297a2.206 2.206 0 0 0 1.922-3.31z' },
  entry: '@acorn/plugin-sentry/node/index.ts',
  factory: 'sentryPlugin',
  client: {
    entry: './src/tree/index.tsx',
  },
  permissions: {
    api: [],
    events: [],
    node: {
      core: ['projects:read'],
      capabilities: [],
      secrets: false,
      exec: false,
      net: ['sentry.io', 'us.sentry.io', 'de.sentry.io'],
      env: ['ACORN_SENTRY_TOKEN', 'ACORN_SENTRY_ORG', 'ACORN_SENTRY_PROJECT', 'ACORN_SENTRY_URL'],
    },
  },
  contributions: {
    // An issue drawn beside the rail list at `/p/:projectId`, with no task, as Rollbar's
    // `rollbar-item` is.
    frames: [{
      target: 'pane',
      id: 'sentry-issue',
      label: 'Sentry issue',
      glyph: 'brand:sentry',
      scope: 'project',
      layout: 'single',
      regions: { body: { kind: 'remote', entry: 'pane' } },
    }],
    // `:issue` carries the whole rail row id (`<connection>:<issue id>`), because an issue id means
    // something only to the credential that read it.
    routes: [{
      id: 'sentry.issue-route',
      path: '/p/:projectId/x/sentry/issues/:issue',
      surface: 'sentry-issue',
      item: 'issue',
      order: 61,
    }],
    sources: [{
      id: 'sentry-issues',
      label: 'Sentry issues',
      glyph: 'brand:sentry',
      order: 31,
      // No `providerId`. The shell hides a source with one until a Settings connection is linked, and
      // this rail also answers from the environment, and has to say how to connect when neither is
      // there (docs/integrations/sentry.md § Scoping).
      items: '/v1/p/sentry/rail-items',
      projectScoped: true,
      onSelect: { verb: 'navigate', surface: 'sentry-issue' },
      emptyState: {
        message: 'No unresolved issues. Connect Sentry in Settings > Services and follow it here, or set ACORN_SENTRY_TOKEN, ACORN_SENTRY_ORG, and ACORN_SENTRY_PROJECT.',
      },
    }],
  },
}
