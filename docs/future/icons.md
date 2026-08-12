# Brand marks, and letting a plugin ship its own

Design notes from the icons session (2026-08-12). Nothing below has been built. The question that
started it was "can we add brand logos alongside our SVG logos, and can plugins supply their own" —
and the answer turned out to be that those are the same feature with two feeders, which is why this
file describes one mechanism rather than two.

Companion to [monaco.md](./monaco.md) in posture: the seam gets designed before the third-party
consumer exists, on the same grounds that folder already argues — a contract retrofitted around
existing callers is worse than one designed before them. Unlike monaco.md this one is small. It is a
day's work, not a phase.

## What exists today

One choke point: `packages/client-core/src/ui/Icon.tsx`. It takes a **name string**, looks it up in
`lucide-static/icon-nodes.json` (~706 KB, imported eagerly by `ui/iconNodes.ts`), and draws a 24×24
`<svg>` with `stroke="currentColor"`, `fill="none"` and no `stroke` overrides. Nodes are rendered as
`[tag, attrs]` pairs through `<Dynamic>` — deliberately never `innerHTML`.

When the name does not match, **Icon renders the string as text** in a `span.glyph`. That fallback is
load-bearing rather than a nicety, and every brand mark we ship rides it:

| Mark | What it actually is | Where |
| --- | --- | --- |
| ◇ GitHub | Unicode literal | `plugins/github/src/client/index.ts:26`, `src/server/provider.ts:18` |
| ◷ Linear | Unicode literal | `plugins/linear/src/server/provider.ts:248` |
| ◍ Rollbar | Unicode literal | `plugins/rollbar/src/server/provider.ts:325` |
| ◧ Docker | Unicode literal | `plugins/docker/src/client/sourceContribution.tsx:11` |
| ◎ OpenAI | Unicode literal | `plugins/model-providers/src/server/openai.ts:53` |
| `A` Anthropic | the letter A | `plugins/model-providers/src/server/anthropic.ts:52` |

Plus the one exception, `ui/GithubMark.tsx`: a hand-inlined solid path with a single call site
(`workspaces/WorkspaceProjectAssignments.tsx:333`). Its own header states the reason it is not an
`<Icon>`, and that reason is the whole design problem — Lucide dropped its brand icons, and Icon draws
every glyph stroked and unfilled, which is exactly wrong for a solid brand mark.

`glyph` is a plain `string` in every registry, in `@acorn/protocol` and in the manifest schema. It
cannot be widened to `string | Component`: `core/boundaries.test.ts` forbids a Solid type reaching
server code, and the name→node map is client-only so a name cannot be validated server-side either.
The string field stays a string field. Everything below works within that.

## The decision: ship path data, not SVG documents

**A brand mark is one `d` attribute in a square viewBox.** That is not an approximation — it is
simple-icons' own project rule, and `GithubMark.tsx` is already the same shape by hand. So the unit we
pass around is the `d` string.

That choice is what makes every other question fall out:

- **`d` is a closed grammar.** Command letters, numbers, separators. It cannot express a script, a
  URL, an `xlink:href`, a `<foreignObject>`, a filter, a CSS `@import` or an event handler. There is
  nothing in it to sanitise. Validation is a character-class regex and a length cap.
- **It renders through the path Icon.tsx already has.** Same `<Dynamic>`, no `innerHTML`, no new
  trust boundary — just `fill="currentColor"` in place of the stroke attributes.
- **It themes.** `currentColor` means all 12 themes, for a plugin's mark exactly as for a
  first-party one. This was treated as a hard requirement in the session, and it is what eliminated
  the alternative below.

### Rejected: `<img src="data:image/svg+xml;…">`

The first proposal, on the grounds that an SVG inside an `<img>` gets no script and no network, so
untrusted markup is safe by isolation. It is safe. It is also **uncolourable** — CSS does not cross
into the `<img>`'s document, so the mark cannot follow the theme. Ruled out on that alone.

For the record, the escape hatch exists if a future mark genuinely needs multi-colour artwork:
`mask-image` with `background: currentColor` recolours arbitrary SVG safely, because a mask is never
rendered as a document. It is strictly more machinery for the same result on single-path marks, so it
stays in the back pocket rather than getting built.

### Rejected: accepting an SVG document

The dangerous input, and the one that would have needed a real allowlist parser: `<script>`,
`<use href>`, `<image href>`, `on*` handlers, external references. A logo does not justify a new
sanitiser. If an author has an SVG file, they take the `d` out of it — one line in the plugin docs,
and for anything on simple-icons the string is already isolated.

### Rejected: a `simple-icons` dependency

3300+ icons to obtain six. The paths are copied by hand into the repo instead. Their SVGs are CC0;
the trademarks remain the owners', which is exactly the status quo with `GithubMark.tsx` today.

### Rejected (for loaded plugins): a TSX component

Worth recording because it is the intuitive answer and it is structurally impossible, not merely
discouraged.

A **compiled-in** plugin can already do this — `GithubMark.tsx` *is* a plugin logo as TSX, sitting in
client-core only because that is where its one call site is.

A **loaded** plugin cannot. Its client bundle runs in a sandboxed iframe on `app-plugin://<hash>`:
separate origin, separate JS realm, `connect-src 'none'`, reaching the host through a MessagePort and
nothing else (`apps/desktop/src/app/main/pluginScheme.ts`). A function does not cross a MessagePort. A
component defined in that realm can never be rendered by the host. Making it work means loading plugin
JS into the shell realm, which hands untrusted code the entire shell — precisely what the two-origin
split exists to prevent.

There is a second, independent reason, and it is the argument `docs/third-party/README.md` already
makes for badges: **small chrome is data, not a rectangle.** A rail source's logo draws in the rail
whether or not that plugin's frame is mounted anywhere on screen. It has to be something the host
holds, not something a frame renders. Path data satisfies that; a component cannot.

## One registry, two feeders

The two halves converge because both sides supply the same thing:

- a **compiled** plugin puts the `d` in a const and registers it in its activate;
- a **loaded** plugin puts the `d` in its manifest, and the host registers it on its behalf.

Icon renders them identically. The consequence worth naming: **a plugin moving from compiled-in to
loaded does not change a single glyph string anywhere.** Only the thing doing the registering changes.

Names are prefixed `brand:` — `brand:github`, `brand:linear`. Two reasons. Lucide has 1756 names and
will grow back into brand territory eventually (`chrome`, `figma` are plausible), so the prefix keeps
the resolver unambiguous forever; and it keeps brand marks out of `ICON_NAMES`, which `ui/IconPicker.tsx`
enumerates for user-chosen workspace and task icons. Whether a GitHub logo belongs in that picker is
then a deliberate one-line decision rather than something that happens by accident.

A loaded plugin's mark registers under **its plugin id**, stamped by the host from the roster row and
never read off the descriptor — the same rule `contentLinks`' `providerId` already follows in
`client-core/plugins/chrome/register.ts`. A plugin cannot claim another plugin's mark name.

One plugin is not always one brand, and model-providers is the standing counterexample: one plugin,
two providers, two marks (◎ OpenAI in `openai.ts:53`, `A` Anthropic in `anthropic.ts:52`). A single
`icon` field cannot carry both, so the manifest also takes a named map — `icons` — whose entries
register as `brand:<pluginId>/<key>`. The prefix is stamped from the roster row exactly as the bare id
is, so the map widens what a plugin can *supply* without widening what it can *claim*: `icons` cannot
name another plugin's mark any more than `icon` can.

## Which marks live where

The rule, and it is the part most worth carrying forward:

> A mark belongs in core if and only if a **core surface** renders it. Otherwise it belongs to the
> plugin that draws it.

The reason is the text fallback. If core names `brand:github` and no plugin has registered it —
disabled, uninstalled, bundle untrusted — Icon renders the literal string `brand:github` into the
settings row. Core cannot depend on a plugin having registered a mark, so a mark core draws must be
registered by core.

Applying that:

- **linear, rollbar** are loaded plugins → manifest `icon`, one mark each under their plugin id.
- **model-providers** is a loaded plugin that is home to two brands → manifest `icons`, with `openai`
  and `anthropic` entries rendering as `brand:model-providers/openai` and
  `brand:model-providers/anthropic`. It is also node-only with no client bundle at all, which is the
  clearest demonstration that the carrier has to be data: it works with zero client code.
- **docker** is compiled in → registers in its own client activate. Its ◧ appears only inside
  `plugins/docker/` (footer badge, rail badge, source contribution).
- **github stays in core.** `WorkspaceProjectAssignments.tsx:333` is core drawing the mark for
  `project.github`, a first-class field on the project row (`packages/protocol/src/api.ts:90`). Core
  owns the field, so core owns rendering it.

That last point **survives GitHub becoming a plugin**, which was the assumption worth correcting in
the session. The mark follows the data model, not the plugin boundary. Moving it out means
generalising `github: { owner, name, repoId } | null` off the project row — real work, and entirely
unrelated to icons. What the change here *does* remove is a module import from client-core into a
brand-specific component, which is worth having on its own.

So core's list has exactly one entry, and the comment above it should say so honestly: *core's own
marks — a mark is here if and only if a core surface renders it.*

## The gating consequence, accepted deliberately

A loaded plugin's mark is registered inside `registerChrome`, which only runs for rows that pass
`eligible()`. That gate has two arms, and the mark rides both as-is:

- A plugin **with a client bundle** needs `bundleAccepted`. Before a user trusts its bytes, its mark
  does not exist — and this is consistent rather than a gap, because no chrome registers at all in
  that state, so there is no glyph missing from anything.
- A plugin **with no client bundle** passes `eligible()` with no trust prompt at all — model-providers
  depends on this — so for a manifest-only package, installing it is the only gate its logo ever
  meets.

The second arm is the standing rule for descriptor chrome (a descriptor executes nothing), and a logo
is not an exception to it. But it is worth stating precisely: the guarantee is "untrusted *code*
cannot put a logo on screen", not "unreviewed *packages* cannot". A code-free manifest can paint any
mark it likes into the rail the moment it is installed, which is one more reason the trust dialog
below should not lean on the mark for identity.

## The contract

Two fields, at the manifest **top level** beside `name` and `version`, where `glyph` stays
per-contribution: `icon` for the plugin's own logo (the common case, and the whole story for every
current plugin except one), and `icons` for the plugin that is a home to several brands.

```jsonc
{
  "id": "linear",
  "name": "Linear",
  "version": "0.1.0",
  "apiVersion": "1",
  "icon": { "d": "M2.886 4.18A11.94 11.94 0 0 1 …" },
  "contributions": {
    "sources": [
      { "id": "linear-issues", "label": "Linear", "glyph": "brand:linear", "order": 20,
        "items": "/v2/p/linear/issues" }
    ]
  }
}
```

And the plural case — model-providers has no `icon` of its own to promote, only the two brands it
hosts:

```jsonc
{
  "id": "model-providers",
  "icons": {
    "openai": { "d": "M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 …" },
    "anthropic": { "d": "M13.827 3.52h3.603L24 20.48h-3.603 …" }
  }
}
```

In `packages/node-core/src/main/pluginManifest.ts`:

```ts
// The plugin's logo: one SVG path's `d` attribute, and deliberately not an SVG document.
//
// A document would mean `<script>`, `<use href>`, `<image href>`, `<foreignObject>`, `on*` handlers and
// CSS `@import` — an allowlist parser and a new trust boundary, for a logo. A `d` string has none of
// that reachable from its grammar, so the check below is the whole check. The renderer fills it with
// `currentColor`, which is why this shape themes and a data-URI `<img>` would not.
const PATH_D_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9eE,.\s+-]+$/

const brandMark = z.object({
  d: z.string().min(1).max(4_096).regex(PATH_D_RE, 'icon must be a single SVG path `d` string'),
  // Square viewBox. simple-icons is 24 throughout; the field exists so an author never has to refit a
  // path by hand, which is the one step of this that can go quietly wrong.
  box: z.number().int().min(1).max(1_024).default(24),
})
```

and one line in `manifestShape`:

```ts
  name: z.string().min(1).max(120),
  icon: brandMark.optional(),
  // The plural feeder. Keys become the suffix in `brand:<pluginId>/<key>`; the prefix is stamped by
  // the host, so the key namespace is private to the plugin and needs no global uniqueness. Capped
  // because a manifest is wire input and every entry becomes a registry row.
  icons: z.record(z.string().min(1).max(32).regex(/^[a-z0-9][a-z0-9-]*$/), brandMark)
    .refine((marks) => Object.keys(marks).length <= 16, 'too many icons')
    .optional(),
```

## The renderer

`packages/client-core/src/ui/brandMarks.ts` (new):

```ts
import { Registry } from '../registries/registry'

export type BrandMark = {
  id: string
  d: string
  // The square viewBox this path was authored in. simple-icons is 24 throughout, which is why that is
  // the default — but GitHub's own mark is a 16 box, and refitting a path by hand is a good way to
  // ship a subtly wrong logo. Carrying the number is cheaper and exact.
  box?: number
}

// Registry rather than a plain map: a loaded plugin's mark arrives and leaves with its roster row, and
// Registry already gives disposal plus the duplicate-id throw the caller catches.
export const brandMarkRegistry = new Registry<BrandMark>('brand mark')

// CORE'S OWN MARKS. A mark is here if and only if a core surface renders it — core cannot name a mark
// and hope a plugin registered it, because Icon's fallback would print the literal string. Everything
// else belongs to the plugin that draws it.
const CORE: BrandMark[] = [
  // Verbatim from the retired ui/GithubMark.tsx, 16 box and all. Core draws this for `project.github`
  // in workspaces/WorkspaceProjectAssignments.tsx.
  { id: 'github', box: 16, d: 'M8 0C3.58 0 0 3.58 0 8c0 3.54 …' },
]

for (const mark of CORE) brandMarkRegistry.register(mark)
```

`ui/Icon.tsx`:

```tsx
const BRAND = 'brand:'

export const hasIcon = (name: string): boolean =>
  name.startsWith(BRAND) ? brandMarkRegistry.get(name.slice(BRAND.length)) !== undefined : name in nodes

// The svg element itself, identical for both families. Only the contents differ: Lucide is stroked and
// unfilled, a brand mark is one filled path.
function Frame(props: { size?: number | string; class?: string; title?: string; box: number; children: JSX.Element }) {
  return (
    <svg
      class={props.class}
      width={props.size ?? '1em'}
      height={props.size ?? '1em'}
      viewBox={`0 0 ${props.box} ${props.box}`}
      role={props.title ? 'img' : undefined}
      aria-hidden={props.title ? undefined : true}
    >
      <Show when={props.title}>{(t) => <title>{t()}</title>}</Show>
      {props.children}
    </svg>
  )
}

export default function Icon(props: { name: string; size?: number | string; class?: string; title?: string }) {
  const brand = () => props.name.startsWith(BRAND) ? brandMarkRegistry.get(props.name.slice(BRAND.length)) : undefined
  return (
    <Switch
      // Still load-bearing: an unmatched name renders as text, which the remaining inline literals
      // (◆/◇ pin state, ⊘ hidden) depend on.
      fallback={
        <span class={`glyph ${props.class ?? ''}`} aria-hidden={props.title ? undefined : true} title={props.title}>
          {props.name}
        </span>
      }
    >
      <Match when={brand()}>
        {(mark) => (
          <Frame size={props.size} class={props.class} title={props.title} box={mark().box ?? 24}>
            <path fill="currentColor" d={mark().d} />
          </Frame>
        )}
      </Match>
      <Match when={nodes[props.name]}>
        {(icon) => (
          <Frame size={props.size} class={props.class} title={props.title} box={24}>
            {/* Lucide's stroke setup, moved off the svg onto a group so Frame stays family-agnostic. */}
            <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <For each={icon()}>{([tag, attrs]) => <Dynamic component={tag} {...attrs} />}</For>
            </g>
          </Frame>
        )}
      </Match>
    </Switch>
  )
}
```

The `<g>` move is the only behavioural change to existing icons. Stroke attributes inherit identically,
but it is the first thing to eyeball if a Lucide glyph looks wrong after the change.

## Carrying the field from disk to the renderer

Four hops, one small addition each. All of them pass the value through untouched; nobody but the
manifest schema validates it and nobody but Icon renders it.

1. `node-core/main/pluginManifest.ts` — the `brandMark` schema and the `icon`/`icons` fields (above).
2. `node-core/main/pluginLoader.ts` — `installedPluginInfo()` projects them onto `InstalledPluginInfo`,
   in the same `...(x === undefined ? {} : { x })` style as `source` and `installedAt`.
3. `node-core/server/routes/plugins.ts` — `declared()` passes it into the roster row. No new route:
   it rides the roster the client already reads.
4. `protocol/src/api.ts` — `icon?: { d: string; box: number }` and
   `icons?: Record<string, { d: string; box: number }>` on `InstalledPluginRow`.

Then the client half, in `client-core/plugins/chrome/register.ts` inside `registerChrome`:

```ts
  const installed = row.installed!
  // Under the plugin id, so every contribution in this manifest can name it as `brand:<id>` — and a
  // plugin moving from compiled-in to loaded does not change a single glyph string anywhere.
  if (installed.icon) add('icon', pluginId, () => brandMarkRegistry.register({ id: pluginId, ...installed.icon }))
  // Named extras under `<pluginId>/<key>`. The prefix is stamped here, never read off the row, which
  // is what keeps `icons` from claiming another plugin's mark.
  for (const [key, mark] of Object.entries(installed.icons ?? {}))
    add('icon', `${pluginId}/${key}`, () => brandMarkRegistry.register({ id: `${pluginId}/${key}`, ...mark }))
```

`add` already catches and warns on a duplicate id, so a plugin colliding with a core mark is handled
with no extra code — and core wins, which is the correct precedence while both exist.

Finally, `brandMarkRegistry` needs exporting from `@acorn/plugin-api/client`, beside `sourceRegistry`
(`packages/plugin-api/src/client/index.ts`). Loaded plugins go through the manifest and never touch
it; compiled ones (docker, and github's own source glyph) do. It is not a component, so `/client` is
the right entrypoint rather than `/ui`.

## Sequence

Two steps, and the first is worth shipping alone.

**1 — the renderer and core's mark.** `brandMarks.ts` with the single github entry, the fill branch in
`Icon.tsx`, delete `ui/GithubMark.tsx`, and change its one call site to
`<Icon name="brand:github" title="GitHub repository" />`. Self-contained, no protocol change, and it
removes a brand-specific component from client-core on its own merits.

**2 — the plugin feeders.** The manifest fields and their four hops, the `plugin-api/client` export,
and then the five marks move out to the plugins that own them: linear and rollbar by manifest `icon`;
model-providers' two by manifest `icons`; docker by its own activate; github's source glyph naming
core's mark. The Unicode literals in those files go away with them.

## Open decisions

- **The plugin trust dialog.** `client-core/plugins/PluginTrustDialog.tsx:164` currently draws the
  first letter of the plugin's name. A logo would look better and is also a phishing surface — nothing
  stops a hostile package shipping GitHub's mark in the prompt that asks whether you trust it. Note
  the gating section above means an untrusted plugin's mark is not registered anyway, so making this
  work would need a deliberate exception. The suggestion on the record is: name prominent, logo small
  or absent. Undecided.
- **Fill rule.** simple-icons authors against the default nonzero rule. If a converted mark renders
  with its holes filled in, that is why. Add an optional flag when a real mark needs one rather than
  building the knob now.
- **Multi-path marks.** Not supported, and widening `d` from a string to an array later is backward
  compatible — so the door stays shut until something needs it.
- **Brand marks in `IconPicker`.** Excluded by the `brand:` prefix keeping them out of `ICON_NAMES`.
  Including them for user-chosen workspace and task icons is a one-line addition if wanted.

## Not in scope

- **Making GitHub a plugin.** Discussed alongside this and genuinely separate: the coupling is
  `github: { owner, name, repoId } | null` on the project row, not the icon.
- **Multi-colour or raster logos.** The `mask-image` route covers the first if it is ever needed; the
  second has no proposal and no consumer.
- **A plugin asset tree.** `pluginScheme.ts` serves exactly `/`, `/ui.css` and `/client.js`, and its
  one-file-per-bundle rule is deliberate because it keeps the hash claim auditable. Nothing here asks
  for that to change — which is a large part of why path data won.

## One stale reference to fix while in here

`packages/client-core/src/styles/base.css:26` points at `docs/ui-design.md § Icons`. That section does
not exist. Either write it or drop the pointer; if written, it should state the two families and the
core-vs-plugin rule above.

Note also that `--font-glyph` still earns its keep after the Unicode brand literals are gone: ◆/◇ pin
state in `tasks/TaskPaneHost.tsx:153` and ⊘/◉ in `workspaces/WorkspaceProjectAssignments.tsx:306` are
still text. Do not remove it with them.
