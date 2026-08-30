# Phase 3: style packs as data

Status: not started. Waits on phase 0.

## Goal

`contributions.styles` exists, mirroring `contributions.themes`: a plugin ships a style pack as a
validated token map, the host generates the CSS, the pack appears in Settings → Appearance, and a
bad value is refused whole. Proven with a device-held pack that is denser than `terminal` and uses a
different monospace stack.

## Why this phase, and why now

The registry exists and its own header says a plugin should be able to feed it. The refusal in
`docs/ui-design.md` was about judgement, and phase 0 changed the judgement: a device-held pack is a
choice the user made for the device they are looking at. The mechanism is the themes one with a
different value alphabet, so the phase is small.

## Scope

In:

- `contributions.styles: [{ id, label, description?, tokens }]` in `pluginContract.ts`, with the
  per-family validator from [05-appearance-and-icons.md](./05-appearance-and-icons.md) as one
  function in `@acorn/protocol`.
- - `packages/client-core/src/plugins/chrome/styles.ts` (new) beside `themes.ts`: `pluginStyleId`,
  `pluginStyleBlock`, `registerPluginStyle`, `pluginStyleStyleSheet`.
- The node validates on install; the device validates on manifest read; both call the one function.
- `styleRegistry` entries from plugins; Settings → Appearance lists them under the plugin's label.
- Fallback to the default pack for an unregistered or refused id, pref never rewritten.
- The 25-selector cap in `tokenAxes.test.ts` restated as first-party only.
- The `--shadow-color` indirection: the built-in packs already reference a theme token for shadow
  colour; the test that holds it becomes an invariant so the alphabet's shadow rule stays
  enforceable.
- A device-held test pack in the fixture.

Out: icon sets (parked), any new style token, any change to the theme contribution.

## Design detail

**The validator as a table.** `STYLE_TOKEN_FAMILIES` in `ui/tokenAxes.ts` maps each `STYLE_TOKENS`
entry to a family name, and `styleValueAlphabet` in `@acorn/protocol` maps a family to a predicate.
A token with no family is a test failure, so a new style token cannot be added without deciding its
alphabet. This is the shape the parked icon door asks for: an `icon` family later is a row.

**Derived style tokens.** `tokens-style.css` declares some tokens as `var()` of others (the role
tokens `--gap-row` and friends over `--space-*`). Those are listed as `DERIVED_STYLE_TOKENS` beside
`DERIVED_THEME_TOKENS` and refused in a pack, as derived theme tokens are refused in a theme.

**Partial families.** A pack that sets `--space-1` through `--space-6` and not `--space-7` is
accepted, the missing ones fall back to the default pack's values through the cascade, and the
Settings row lists the families the pack sets. A pack that sets nothing in a family sets nothing.

**Where the generated CSS goes.** `pluginStyleStyleSheet()` is appended to the same `<style>` the
theme sheet uses, after `tokens-style.css` and the built-in packs, so a plugin pack's selector
`:root[data-style="plugin:..."]` wins on order within equal specificity. The attribute value cannot
match a built-in because of the `plugin:` prefix.

**Frames.** `FRAME_TOKENS` are projected to plugin frames over the port as inline custom properties.
A plugin style pack changes the projected values the same way a built-in one does, because the
projection reads computed values.

## Code touched

- `packages/protocol/src/pluginContract.ts`: `contributions.styles`.
- `packages/protocol/src/styleValues.ts` (new): the family predicates.
- `packages/client-core/src/ui/tokenAxes.ts`: `STYLE_TOKEN_FAMILIES`, `DERIVED_STYLE_TOKENS`.
- `packages/client-core/src/infra/styles/tokenAxes.test.ts`: every style token has a family; the cap is
  first-party only; the shadow-colour indirection invariant.
- `packages/client-core/src/plugins/chrome/styles.ts` (new).
- `packages/client-core/src/plugins/contributions.ts` and `frames/register.ts`: register styles per
  plugin, gated on trust like themes.
- `packages/node-core/src/server/plugins/manifest.ts`: the validator on install.
- `packages/client-core/src/settings/AppearanceSettings.tsx` (or wherever the style picker lives;
  verify): plugin packs listed.
- `packages/plugin-types/acorn-plugin.schema.json`: regenerated.
- `docs/plugin-authoring.md`, `docs/ui-design.md`, `docs/contribution-kinds.md`.

## Tests

- `styleValues.test.ts`: each family accepts its examples and refuses `url(`, `expression(`, `;`,
  `}`, a literal colour in a shadow, a `var()` in a length, and an unknown token.
- `styles.test.ts`: a valid pack generates one block with the namespaced selector; a pack with one
  bad value is refused whole with a roster row; a derived token is refused.
- `tokenAxes.test.ts`: every `STYLE_TOKENS` entry has a family.
- `resolveStyle` (or the existing equivalent): an unregistered id falls back and the pref is
  unchanged.
- The device-held test pack changes `--row-h` in the running app and reverts on uninstall.

## Docs owed

Per [docs-migration.md](./docs-migration.md), phase 3 rows: `docs/ui-design.md § Token axes`,
`docs/plugin-authoring.md § Themes`, `docs/contribution-kinds.md`.

## Doors left open

The validator is a family table so the parked icon family is a row. No phase here names an `icons`
key for anything but brand marks. Against [07-hosts.md](./07-hosts.md): the validator is a protocol
function with no DOM dependency, so the terminal host can validate a pack it will mostly ignore
(density is the one style axis a terminal keeps, per `docs/ui-design.md`).

## Done when

- A device-held style pack is installed, accepted, appears in Settings → Appearance, changes density
  and the mono font, and is refused when a value is edited to `url(x)`.
- `pnpm lint`, `pnpm test`, and the desktop boot test are green.

## Verify before building

- `packages/client-core/src/registries/styles.ts` exports `styleRegistry` with `StyleContribution =
  { id, label, description? }` and no writer other than `settings/uiStyles.ts`.
- `packages/client-core/src/plugins/chrome/themes.ts` exports `pluginThemeId`, `pluginThemeBlock`,
  `registerPluginTheme`, `pluginThemeStyleSheet`; copy its shape.
- `packages/client-core/src/ui/tokenAxes.ts` exports `STYLE_TOKENS` as a list with `--radius-*`,
  `--space-*`, `--font-*`, `--shadow-*`, `--fs-*`, `--lh*`, `--fw-*`, `--*-transform`,
  `--*-tracking` entries; check the exact list before writing the families.
- `packages/client-core/src/infra/styles/tokenAxes.test.ts` has the 25-selector cap.
- The built-in packs' shadows reference a theme token for colour. If any uses a literal, fix that
  first or the alphabet's shadow rule is a lie about the built-ins.
- Phase 0 of this folder has shipped.
