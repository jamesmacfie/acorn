# Appearance and icons: style packs as data, and the parked icon door

Part of [docs/future/client-plugins/](./README.md). Phase 3 builds style packs. Nothing builds icon
sets; this file holds the door open.

## What exists

`docs/ui-design.md § Token axes` describes two disjoint axes on `<html>`:

- `data-theme` selects colour: 21 or 22 palette primitives restated per theme, about 15 derived
  tokens declared once as `var()` references, three self-description tokens the host writes. Plugins
  contribute a theme as data through `contributions.themes`; the host validates every key against
  `THEME_PALETTE_TOKENS`, every value against `isThemeColorValue` (a hex literal or a flat colour
  function whose argument alphabet excludes the characters that could close a declaration), and
  generates `:root[data-theme="plugin:<pluginId>:<themeId>"]` itself in
  `packages/client-core/src/plugins/chrome/themes.ts`. No plugin CSS reaches the shell.
- `data-style` selects shape, typography, space, density, chrome, and motion: `tokens-style.css`
  plus one of three packs. `STYLE_TOKENS` in `packages/client-core/src/ui/tokenAxes.ts` is the list,
  and `styles/tokenAxes.test.ts` holds both axes to their files. `registries/styles.ts` exists and
  its header says it "mirrors registries/themes.ts so a plugin can contribute a style pack the same
  way it would contribute a theme," but no `ctx` member and no manifest key feed it.
  `docs/plugin-authoring.md` says style packs are not contributable, and `docs/ui-design.md` gives
  the reason: "the mechanism would be the same; the judgement is not."

Icons resolve by name in `packages/client-core/src/ui/Icon.tsx`: a `brand:` prefix looks up
`brandMarkRegistry` (one SVG path `d` in a 24-box, drawn with `fill="currentColor"`), anything else
looks up Lucide's `iconNodes` (rendered through `<Dynamic>`, never `innerHTML`), and an unmatched
name renders as text. Plugins add `brand:` marks through `brandMarkRegistry.register()` or manifest
`icon`/`icons`. Nothing replaces a Lucide glyph.

## Style packs as data

The judgement changes when the person installing the pack is the person who will look at it. A
device-held style pack is a choice the user made for this device, and "cannot break the app" is
answered the way it is for themes: by the value alphabet and by the fallback.

### The contribution

`contributions.styles: [{ id, label, description?, tokens }]`, mirroring `contributions.themes`. The
host generates `:root[data-style="plugin:<pluginId>:<styleId>"]` and registers the id in
`styleRegistry`. Ids are namespaced, so a plugin can never redefine `modern`, `cozy`, `cute`, or the
attribute-less default.

### The value alphabet

Every key must be in `STYLE_TOKENS` and every value must pass one of these, by token family:

| Family | Tokens | Accepted values |
| --- | --- | --- |
| Length | `--radius-*`, `--bw-*`, `--*-w`, `--space-*`, `--pad-*`, `--gap-*`, `--*-h`, `--icon-*`, `--avatar-*`, `--fs-*` | a number with `px`, `rem`, `em`, or `%`, or `0` |
| Number | `--lh*`, `--fw-*` | an unsigned decimal |
| Keyword | `--label-transform`, `--heading-transform` | one of `none`, `uppercase`, `lowercase`, `capitalize` |
| Tracking | `--*-tracking` | a signed length or `normal` |
| Font stack | `--font-mono`, `--font-ui`, `--font-glyph`, `--font-display` | a comma list of quoted names and generic families, letters, digits, spaces, and hyphens only |
| Shadow | `--shadow-*` | a comma list of shadow terms whose colour is a `var(--...)` naming a theme token, never a literal colour |
| Motion | `--motion-*` | a duration in `ms` or `s`, or a cubic-bezier with four unsigned decimals |

A derived style token (one declared once in `tokens-style.css` as a `var()` of another) is refused
in a pack, as a derived theme token is refused in a theme. A pack must restate every base token or
none in a family; partial families fall back to the default pack for the missing ones, and the
Settings row shows which families the pack sets.

The shadow rule is the one that took thought. Shadows carry colour, and colour is the theme's. A
pack that wants a soft shadow says `0 1px 2px var(--shadow-color)` and the theme decides the colour.
That is also how the built-in packs do it today, which is what makes the rule enforceable.

### The 25-selector cap

`tokenAxes.test.ts` caps each built-in pack at 25 selectors reaching past the token block. A plugin
pack has zero, by construction, because it is tokens and nothing else. The cap becomes a rule for
first-party packs only and the doc says so.

### Fallback

A preference naming an unregistered style falls back to the default pack and is never rewritten, as
`resolveTheme()` does for themes. A pack whose tokens fail validation on the device is refused
whole, with a roster row, and the preference falls back the same way.

### Both sides check

The node validates a manifest's `styles` on install, as it does `themes`. The device validates it
again when the manifest is read back, because a device-held plugin never passed a node. The
validator is one function in `@acorn/protocol`, imported by both.

## Icons: parked, door held open

The owner parked icon sets on 2026-08-29. This section records the shape so that when the door opens
nothing built in the meantime is in the way.

The contribution would be `contributions.icons: { <name>: <path d> }`, a map from a Lucide-shaped
name to one SVG path's `d` attribute in a 24-box, validated as brand marks are, and drawn with
`stroke="currentColor"` where Lucide is stroked. A plugin set would be a second lookup in `Icon.tsx`
between `brand:` and Lucide, chosen per device under a `PrefKeys.iconSet` pref, with an unmatched
name falling through to Lucide so a partial set works. The `brand:` namespace would be untouched,
and `ICON_NAMES` (the user's task-icon picker) would read from the active set.

What this folder does to keep that possible:

- No phase uses the manifest key `icons` for anything other than brand marks, and no phase adds a
  key named `iconSet` or `iconSets`.
- `Icon.tsx` keeps its three-step resolution in one function, so a fourth step is one insertion.
- The path validator for brand marks stays a shared function rather than being inlined, so a second
  caller can use it.
- Phase 3's value-alphabet validator is written per token family in a table, so an `icon` family
  with a path-data alphabet is a row, not a new validator.

Nothing else. Parked means parked.
