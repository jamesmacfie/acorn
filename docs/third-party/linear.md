# linear → loaded plugin

**Blockers: none.**

## What has changed since this was written

This brief predates the rollbar migration. It is still right about linear; three mechanics below
have moved.

- **`rollbar.md` no longer exists.** It was cleared along with these four when `docs/third-party/`
  became the review record. The reference is now [README.md](./README.md) plus the plugin itself,
  `plugins/rollbar/`.
- **A plugin package holds no `acorn-plugin.json`.** The manifest is *generated* by
  `apps/node/scripts/build-plugin.mjs` from its `PLUGINS` table, so every manifest sketch below is a
  sketch of a row in that table, not of a file you add to `plugins/linear/`.
- **The route carrier has a reference implementation**: `plugins/rollbar/src/server/routes/rollbar.ts`.
  Keep the Hono router, hand `router.fetch` to `ctx.routes.fetch` (or `ctx.providers.integration`),
  and carry the `PluginRequestContext` in through `c.env` behind a module-level symbol. The same
  routes then run in both tiers, which is what keeps the direct route tests useful.

Read [README.md](./README.md) first — this is the same shape as rollbar plus three things, and only
the third is interesting.

## What it adds over rollbar

**1. Content links.** Linear registers a recogniser so a `linear.app/acme/issue/ENG-1` URL in a PR
body, note or transcript opens the Linear pane instead of the browser
(`client/contentLink.ts`, `contract/scanRefs.ts`). Loaded plugins declare these in the manifest:

```jsonc
"contentLinks": [{
  "id": "linear.issue",
  "match": "https://linear.app/{workspace}/issue/{key}",
  "openPane": "linear",
  "item": "key"
}]
```

The host compiles the pattern — a restricted URL grammar, not a regex, because a manifest is
untrusted input and a plugin-supplied regex could hang the renderer on every link in a document.
Captures ride to the pane as its selection. `contract/scanRefs.ts` is a different thing and stays:
it scans PR *text* for ticket references, which is the plugin's own logic, not a URL recogniser.

**2. A ref panel.** github's `PullDetail` renders Linear's panel beside a PR so you can see the
ticket without navigating away — and it does it without importing linear, through
`refPanelFor('linear')`. This looks like a first-party privilege and is not: `refPanel` is one of
the frame targets, and the adapter passes `refId` and `onClose` into the frame
(`packages/client-core/src/plugins/frames/register.tsx`).

Two of `RefPanelProps` do not cross: `onContentClick` (the host's handler for clicks inside
rendered provider markdown) and the multi-ref `refs`/`onSelectRef` chip strip. Neither matters
here — `PullDetail` is named in the registry's own comment as a single-ref host, and a frame
handles clicks inside its own document. If you later want a frame ref panel in a multi-ref host,
that is a real gap to raise, not something to work around.

The panel is also the thing to check first at cutover. It is the one surface another plugin
renders, so a regression shows up in github's PR view rather than in Linear's own, and nobody
looking at Linear will see it.

**3. Looser promotion.** A Linear issue carries its own branch name, so `canPromote` asks for less
than Rollbar's. On the descriptor path that means fewer cases where the host modal refuses — the
same mechanism, just less strict.

## Manifest sketch

Same as rollbar's, plus:

```jsonc
"contributions": {
  "frames": [
    { "target": "pane",     "id": "linear",       "label": "Linear", "glyph": "square-check", "order": 40 },
    { "target": "refPanel", "id": "linear-ref",   "label": "Linear issue", "providerId": "linear" }
  ],
  "contentLinks": [ /* above */ ],
  "sources": [ /* as rollbar */ ]
}
```

`providerId` on a ref panel must equal the plugin id — the adapter throws otherwise, which is the
manifest version of the ownership check the client host already runs over first-party
contributions.

## Why you might do this one instead of rollbar

Only one reason, and it is a good one: linear exercises **two surfaces the loaded tier has never
run in production** — a frame ref panel and declarative content links. Rollbar exercises the more
common shape; linear exercises the shapes most likely to be subtly broken. If the goal is finding
bugs rather than proving the happy path, this is the better target.

Against it: a regression here is visible inside github's PR view, which is a higher-traffic
surface than Rollbar's rail. Do rollbar first if you want the safer experiment.

## Done when

Everything in rollbar's list, plus: a Linear URL pasted into a note resolves in-app, and github's
PR detail renders the ticket panel from the loaded plugin with no visible difference.
