# 04 — Fold the loaded tier's repeated mechanics behind the facade

**Strength: Strong. Small, mechanical, four immediate callers for each helper.**

## The problem, plainly

Every loaded plugin starts by pasting the same ~90 lines out of the previous loaded plugin: a
block that smuggles the request context through Hono, a block that boots the frame, and (for
integration providers) a codec for rail item ids. None of it is about the plugin. All of it is
about how the host carries requests, mounts frames, and round-trips ids — mechanism the author
cannot get creatively right, only identically right or subtly wrong. The fifth loaded plugin will
paste it all again.

## What happens today

**The portable-carrier block — 4 copies, ~15 lines each, identical modulo the plugin's name.**
Found at:

- `plugins/database/src/server/routes/database.ts:44-53` (+ wrapper at `:319`)
- `plugins/http/src/server/routes/http.ts:33-42` (+ `:476`)
- `plugins/linear/src/server/routes/linear.ts:62-70` (+ `:381`)
- `plugins/rollbar/src/server/routes/rollbar.ts:35-53` (+ `:189`)

The block, as it appears in each:

```ts
const PORTABLE_REQUEST_CONTEXT = Symbol('<name>-plugin-request-context')
type PortableBindings = AppEnv['Bindings'] & { [PORTABLE_REQUEST_CONTEXT]?: PluginRequestContext }
const requestContext = (c: Context<AppEnv>): PluginRequestContext => {
  const context = (c.env as PortableBindings)[PORTABLE_REQUEST_CONTEXT]
  if (!context) throw new Error('<name> routes only run over the portable carrier (create<Name>Fetch)')
  return context
}
// …and at the bottom of the file:
export const create<Name>Fetch = (…): PluginFetchHandler => {
  const routes = create<Name>Routes(…)
  return (request, context) => routes.fetch(request, { [PORTABLE_REQUEST_CONTEXT]: context } as PortableBindings)
}
```

Even the three-line explanatory comment above `create*Fetch` is duplicated prose in linear and
rollbar.

**The frame bootstrap — 4 copies, ~12 identical lines each.**
`plugins/{database,http,linear,rollbar}/src/frame/index.tsx` (27/25/26/21 lines). Identical
structure: inject the stylesheet, create the root div, `connect().then(render)`, show an error
class if connect fails. The only real differences are the CSS module name, the App component name,
and the error class name (`db-error` / `http-frame-error` / `ln-error` / `rb-error`).

**The rail-item-id codec — 2 copies.** `plugins/linear/src/shared/rail.ts` (60 lines) and
`plugins/rollbar/src/shared/rail.ts` (47 lines) both implement
`encodeURIComponent(a) + ':' + encodeURIComponent(b)` and a matching parse with the same
`indexOf(':')` boundary checks and try-decode-catch-null. Linear's comment even says
"Percent-encoded around a single `:` for the same reason rollbar's is". Round-tripping a rail item
id is a host contract, not a Linear or Rollbar fact.

## Why it matters, simply

Copy-paste of host mechanism is how bugs spread: if the carrier or the mount sequence ever needs
to change (a frame handshake timeout, say — see file 01), it's a four-plugin sweep instead of one
edit. And every line an author pastes without understanding is a line they can mis-edit. Moving
these behind the facade means a loaded plugin's server file starts at "here are my routes" and its
frame file starts at "here is my App".

## The change

Three small helpers on the facade (each has four — or two — immediate callers, so the "unexercised
seams rot" rule is satisfied on day one):

1. **`@acorn/plugin-api/node`:** a `portableFetch` helper and a `requestContext` accessor. Shape
   sketch (final naming up to the implementer):

   ```ts
   // host side, once:
   export const portableRoutes = <T>(build: (ctx: () => PluginRequestContext) => Hono<AppEnv>) => …
   // plugin side, after:
   export const createLinearFetch = (projects: ProjectsSeam): PluginFetchHandler =>
     portableFetch(createLinearRoutes(projects))
   ```

   The Symbol, the `PortableBindings` type, and the guard live in one place.

2. **`@acorn/plugin-api/ui/sdk`:** a frame mount helper —
   `mountFrame({ styles, App, errorClassName })` — owning style injection, the root element,
   `connect().then(render)`, and the failure fallback. This is also the natural home for the
   frame-side half of a handshake ack (file 01, change 5).

3. **A shared rail-item-id codec** exported beside the contribution types (protocol or `/client`,
   wherever `RailItem` lives), replacing both plugins' `shared/rail.ts` implementations.

Then migrate the four plugins mechanically and delete ~150 lines.

## Notes for whoever picks this up

- Growing the facade surface is a deliberate act here: regenerate
  `packages/plugin-api/src/surface.snapshot.txt` via
  `UPDATE_SURFACE=1 pnpm --filter @acorn/plugin-api test`, and read file 07 about what surface
  growth should mean for `PLUGIN_API_MAJOR`.
- The sdk entrypoint (`/ui/sdk`) is framework-free today. `mountFrame` takes a render callback, so
  it can stay framework-free — don't let Solid leak into it (the four frames happen to use Solid,
  but the sandbox explicitly allows any framework).
- Keep the error prose in `requestContext`'s guard parameterized by plugin name — it's the one
  string that genuinely differs, and it's load-bearing for debugging.
- The four migrated plugins are rebuilt packages; remember the repo gotcha that host-side changes
  do nothing for a loaded plugin until its package is rebuilt (`build:plugin <id>`), and that a
  dev copy may be frozen by a `user` ownership row (file 02).
- Acceptance: the loaded-plugin integration suites (`apps/node/test/integration/{pluginLoader,
  httpLoaded,rollbar,linear}.test.ts`) stay green; the four route files and four frame files lose
  their preamble; `git grep PORTABLE_REQUEST_CONTEXT plugins/` returns nothing.
