# CodeBlock

A monospace, sunken, scrollable block for code, logs, config, diffs-as-text, and credentials —
with an optional copy affordance. Bootstrap styles `<pre>/<code>`; shadcn leaves it to typography
plugins. acorn has at least **nine separate mono-block rules** and three separate copy-feedback
idioms sitting on top of them.

## Today

- core: `.config-trust-diff` (`config-trust.css:8-19`), `.node-fingerprint` (`nodes.css:135-141`),
  `.node-gate-reason` (`shell.css:38-45`), `.integration-device-code` (`integrations.css:202-210`),
  `.gallery-term` (`settings.css:149-157`), `.settings-script` (a *textarea* styled as code,
  `settings.css:78`)
- plugins: github's `.step-log` with per-line dual-theme vars and a hand-rolled hover copy button
  duplicating `CopyButton` (`ChecksPanel.tsx:17-32`, `checks-panel.css:92-110`); http's
  `.http-pre`; database's `.db-sql-preview` (`database.css:339-350`); context's
  `.context-preview-block`; agents' `.agent-context-preview pre`; rollbar's `.rb-code` stack
  frames with a manual `padStart(4)` gutter (`RollbarItemView.tsx:178-191`); onboarding's
  `.wizard-device` credential block (`wizard.css:108-129`)
- Cross-frame breakage: database and the frames reference `.settings-script`, which is **not
  served to frames** (`apps/desktop/src/app/main/pluginFrameStyles.ts`) — dead class, unstyled
  textarea.

## Proposed API

```tsx
export function CodeBlock(props: {
  copy?: boolean | string        // true: copy children's text; string: copy that instead
  wrap?: boolean                 // logs wrap, code scrolls
  size?: 'xs' | 'sm'
  maxHeight?: 'none' | 'block'   // capped-with-scroll variant (previews)
  class?: string
  children: JSX.Element          // usually a string; can be pre-tokenized spans
})
```

Renders `<pre class="ui-code"><code>…</code></pre>` with `CopyButton` absolutely positioned via
the existing `.copyable`/`.copy-abs` convention (`styles/copy.css` is already a shared,
frame-served role sheet).

## How to build it

- `packages/client-core/src/ui/primitives.tsx`; `.ui-code` in `styles/primitives.css`. Tokens:
  `--font-mono`, `--bg-sunken`/`--bg-subtle`, `--control-border`, `--radius-surface`; `data-wrap`,
  `data-size`, `data-max`.
- Frames: `CopyButton` calls `navigator.clipboard`, which sandboxed frames can't use — this is the
  documented blocker in linear/http. Give `CopyButton` an injectable copy function (see the
  CopyButton extension in the [README](./README.md)); `CodeBlock` threads it through. Until then,
  frames render `copy={false}` + their own bridge-toast button.
- Syntax highlighting stays out: callers that highlight (Shiki in `ManagedAgentMarkdown`, the diff
  toolkit) pass tokenized children.
- A code-*textarea* (`.settings-script`'s real job) is a `Textarea` variant, not this component —
  add `mono` to `Textarea` (one data-attr) and retire `.settings-script`.
- Export from `@acorn/plugin-api/ui`.

## Refactors

- Fix the dead classes first: database's two `.settings-script` textareas → `Textarea mono`
  (immediately styled in-frame); `.db-sql-preview` and `.context-preview-block` → CodeBlock.
- github's `.step-log` → CodeBlock (delete the duplicate copy button; keep its ANSI line spans as
  children); rollbar's `.rb-code` (keep its own gutter for now — line numbers are a later prop if
  a second site wants them).
- onboarding's device-code block → CodeBlock `copy` (it already composes CopyButton).
- Core's five mono rules as their files are touched; `.node-gate-reason` and `.config-trust-diff`
  are the highest-traffic.

## Notes

- Logs that stream (docker logs, step logs) keep their own scroll-follow logic; CodeBlock is the
  box, not the tail -f.
