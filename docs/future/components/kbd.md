# Kbd

A keyboard chord rendered as a key cap. shadcn added Kbd in 2025; Bootstrap styles the native
`<kbd>` element. acorn — a keyboard-first app whose docs list ⌘K/⌘P/⌘1-9 as core interactions —
has **three separate keycap CSS rules and zero components**, and most chords are smuggled into
`title=` strings where they get no styling at all.

## Today

- `.rail-tip-key` — the tooltip singleton's chord chip (`tooltip/RailTips.tsx:93`,
  `rail-tips.css:34-43`)
- `.help-key` — the shortcuts overlay + `ShortcutsSettings.tsx:134` (`overlays.css:75-84`)
- `.plugin-trust-escape kbd` (`PluginTrustDialog.tsx:257`, `plugin-trust.css:90-97`)
- onboarding's `<dl class="wizard-keys">` with `<kbd>` terms (`OnboardingWizard.tsx:335-339`,
  `wizard.css:187-195`)

All four: mono font, `--bg-subtle`, `--control-border`, small radius. Meanwhile chords hide in
plain text or titles: "Shift+Enter for newline" (`AgentComposer.tsx:462`), "Previous match (⇧⏎)"
(`DiffToolbar.tsx:38,41,47`), "(⌘↵ to create)" placeholder (`CreatePullForm.tsx:142`), "⌥-click:
add line reference" (`ChangesPane.tsx:300`), `DatabasePanel.tsx:241`, `ContainerDetail.tsx:323`.

## Proposed API

```tsx
export function Kbd(props: { size?: 'xs' | 'sm'; class?: string; children: string })
```

That's the whole component: a styled `<kbd>`. Optionally accept `chord?: string` that splits on
`+`/space into multiple caps — decide when migrating the shortcuts editor, which is the only site
that renders multi-key sequences as separate caps.

## How to build it

- `packages/client-core/src/ui/primitives.tsx`; `.ui-kbd` in `styles/primitives.css`
  (frame-served). Element is `<kbd>`, styling from the union of the three existing rules.
- One subtlety worth keeping from `rail-tips.css`: the keycap must not grow the line-height of the
  row it sits in (fixed height, centred glyph).
- Export from `@acorn/plugin-api/ui`.

## Refactors

- The three shell rules collapse onto `.ui-kbd` (RailTips renders it for `data-tip-key`; the
  shortcuts overlay/editor and PluginTrustDialog swap classes).
- Onboarding's shortcut list becomes `DescriptionList` + `Kbd`.
- Sites hiding chords in `title=`: move to `data-tip-key` (see [tooltip.md](./tooltip.md)) so the
  chord renders as a cap inside the styled tip; visible-hint sites (agents' composer hint) render
  `<Kbd>⇧⏎</Kbd>` inline.
- The onboarding shortcut table is hardcoded because it can't import the keybinding registry
  (barrel constraint noted at `OnboardingWizard.tsx:31-34`) — Kbd doesn't fix that, but flag it:
  the registry could expose a plain-data snapshot on `/client` so help surfaces stop drifting.

## Notes

- Ultra-small scope is the point: ship it in the same PR as Tooltip or DescriptionList rather than
  alone.
