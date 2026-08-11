# StatusDot

The little coloured circle that says running / idle / failed / stale. Neither shadcn nor Bootstrap
ships one (shadcn leans on Badge), but in a workspace app whose rows are processes — agents,
containers, checks, terminals, nodes — the dot is load-bearing vocabulary and acorn has drawn it at
least **ten independent times with two competing colour-token vocabularies**.

## Today

- agents: `.managed-agent-state` (`plugins/agents/src/client/AgentPane.tsx:304`, CSS
  `managed-agents.css:30-48`), `.agent-task-state` (`AgentTaskSidebar.tsx`, two glyph maps),
  `.agent-center-provider-dot` + `.agent-center-state` (`AgentCenter.tsx:187,261`),
  `.agent-usage-health` (`AgentUsageSection.tsx:43`), `.agent-tool-state` (`toolRendererRegistry.tsx:12`)
- docker: `.docker-dot[data-state]` (`docker.css:63-68`) — uses `--state-ok/--state-warn/--state-bad`
  while agents' identical dots use `--add-marker/--warn/--del-marker`. Two vocabularies, one concept.
- github: `.check-dot` AND `.checks-dot` — two parallel families in one plugin
  (`pull-detail.css:103-111`, including a gradient "mixed" state), and `.checks-dot` is *also*
  rendered by core (`packages/client-core/src/tasks/railStatus.ts:37`, `TabRail.tsx:349`,
  `tooltip/RailTips.tsx:106`) — core markup styled by a plugin stylesheet, same inversion as
  `.action-error`.
- notes: `.notes-include-dot` (`notes.css:25-31` — the CSS comment admits it copies "the
  `.checks-dot` recipe"); terminal: `.terminal-tab-dot` (`terminal.css:82-94`, with a pulse
  keyframe); onboarding: `.wizard-dots` (`wizard.css:205-212`); database: `.db-status` text-colour
  variant; editor: the dirty `●` is a string concat (`EditorPane.tsx:296`); http: `.http-dirty`
  (`HttpPanel.tsx:276`).
- core: `NodeChip` (`packages/client-core/src/node/NodeChip.tsx`) is the one *designed* status
  indicator (six-value freshness vocabulary) — keep it, but its dot should be this primitive.

## Proposed API

```tsx
export function StatusDot(props: {
  tone: 'ok' | 'warn' | 'bad' | 'muted' | 'accent'
  pulse?: boolean               // running/pending affordance (terminal's pending tab)
  label?: string                // aria-label; when present renders role="status"
  size?: 'sm' | 'md'            // ~7px and ~10px cover every current site
  class?: string
})
```

Semantic tones, not domain states: the call site maps `running→ok`, `exited→muted`, `failed→bad`.
Sites that need a *mixed* state (github's gradient dot) pass `class` and keep one local rule.

## How to build it

- `packages/client-core/src/ui/primitives.tsx` + `.ui-dot` in `styles/primitives.css`
  (frame-served). `data-tone`, `data-size`, `data-pulse`.
- This is the moment to settle the token question: pick ONE vocabulary — either promote
  `--state-ok/--state-warn/--state-bad` to theme tokens in `styles/tokens-theme.css` (they read as
  status, which is what this is) or standardise on the diff-marker trio. Whichever wins must be
  classified in `packages/client-core/src/ui/tokenAxes.ts` and restated by all 17 theme blocks
  (`tokenAxes.test.ts` enforces both).
- The pulse animation must respect `prefers-reduced-motion` — core's `.spin` already shows how
  (`styles/base.css:66-68`); terminal's two hand-rolled pulse keyframes don't.
- Export from `@acorn/plugin-api/ui`.

## Refactors

- `tasks/railStatus.ts` returns a `tone` already — render `StatusDot` in `TabRail.tsx:349` and
  `RailTips.tsx:106`, then delete `.checks-dot` from github's CSS (fixes the core-styled-by-plugin
  inversion).
- agents' five dot families; docker's `.docker-dot`; github's `.check-dot`; notes'
  `.notes-include-dot` (its clickable on/off form is a toggle — pair StatusDot with a bare Button,
  or see [checkbox.md](./checkbox.md)); terminal's `.terminal-tab-dot` (with `pulse`); the editor
  and http dirty dots.
- `NodeChip` keeps its chip shape but draws its dot with the primitive.
- onboarding's `.wizard-dots` stepper is a different thing (position, not status) — leave it, or
  fold into a future Stepper if a second wizard ever appears.

## Notes

- Deliberately no children: a dot with a label next to it is `Row`/`Badge` composition, not a new
  layout component.
