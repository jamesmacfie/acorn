# Linear browse pane — master/detail redesign

**Status:** proposed, not started.
**Owner:** _unassigned_
**Scope:** `apps/desktop/src/plugins/linear/client/` + a little CSS.

## Goal

Rebuild the Linear Source browse (`LinearBrowse.tsx`) so it reads like the GitHub PR
experience: a list of issues on the left, and selecting one opens its full detail on the
right. Promoting an issue to a task moves to a **hover-revealed button** on each row
(mirroring the PR list's `+ ws` button) instead of being the whole-row click.

The single biggest reason this is cheap: **the detail view already exists.**
`LinearIssuePanel` already renders the full issue (title, state, description, activity log,
threaded comments, composer, "Open in Linear ↗") and already has a `variant="pane"` mode
built for exactly this — being embedded as an in-layout pane. We reuse it verbatim as the
right column. No new detail component.

## Current state (what we're replacing)

`LinearBrowse.tsx` is a **single-pane flat list**:

```jsx
<main class="panes panes-empty">
  <section class="pane linear-browse">
    <div class="section-header">Linear · {ws}  [Projects (n)]</div>
    <ul class="linear-browse-list">
      <For each={issues}>
        {(it) => (
          <li>
            <button class="linear-browse-row" title="Open as task" onClick={() => promote(it)}>
              <span class="linear-browse-id">{it.identifier}</span>
              <span class="linear-browse-title">{it.title}</span>
              <span class="linear-browse-state">{it.state.name}</span>
            </button>
          </li>
        )}
      </For>
    </ul>
  </section>
  {/* project-picker overlay */}
</main>
```

Behaviour today:

- **The whole row is the "create task" action.** Clicking any row calls `promote(it)`,
  which creates a task on the current repo, activates it (`activateTaskSignals(w, {pane:'linear'})`),
  and navigates away. There is **no way to read an issue** inside acorn from the browse — you
  either promote it or open it in Linear elsewhere.
- No detail pane, no selection state, no search/sort/filter.
- A "Projects" button opens a modal to pick which Linear projects are linked to the workspace.

Data flow (unchanged by this work):

- `workspacesOptions` → resolve workspace from routed `owner/repo`.
- `workspaceProjectsOptions(wsId)` → the workspace's linked projects.
- `workspaceLinearIssuesOptions(selected)` → the issue list (`LinearProjectIssue[]`), fanned
  out per connection via `GET /api/linear/project-issues?integration=&ids=`.
- `LinearProjectIssue = LinearIssueSummary & { integrationId, branchName }` — note it already
  carries `integrationId`, which is the `connectionId` the detail fetch wants.

## Reference: how the GitHub PR master/detail works

Source: `PullList.tsx`, `App.tsx`, `pull-list.css`, `tokens-layout.css`.

1. **Layout** is a CSS grid on `<main class="panes">`: left list column + detail column(s).
   The middle/right panes only mount `<Show when={params.number}>`; with no selection they
   collapse to an empty placeholder pane.
2. **Selection is route-driven.** `/:owner/:repo/:number` populates `useParams()`; each row is
   an `<A href=".../{number}">` and the active row is `classList={{ active: params.number === … }}`.
   There is no "selected PR" signal.
3. **The hover "create task" button** — the pattern we copy:

   ```jsx
   <button type="button" class="pr-ws-btn" title="Open as task"
           onClick={(e) => void openAsTask(e, pr)}>+ ws</button>
   ```
   ```css
   .pr-ws-btn { opacity: 0; /* … border/padding … */ }
   .pr-row:hover .pr-ws-btn,
   .pr-row:focus-within .pr-ws-btn { opacity: 1; }   /* hover OR keyboard focus */
   ```
   `opacity` (not `display`) so the row doesn't reflow; `:focus-within` so it's keyboard
   reachable. `openAsTask` calls `e.preventDefault(); e.stopPropagation()` first so the row's
   own navigation doesn't fire.
4. **Task creation** is generic: `createTask({ origin, repoOwner, repoName, branch, … })` →
   `POST /api/tasks`, then `activateTaskSignals(task, { pane })`. Linear already uses this via
   its `promotion` in the source registry.

**What is NOT reusable:** there is no shared list-item or master-detail *component* — the PR
list is hand-rolled in `PullList.tsx`. We reuse the **CSS layout classes** and the
**hover-button idiom**, and we reimplement the small list markup in `LinearBrowse.tsx`.

## Target design

Two-column layout inside the Linear Source pane:

```
┌─────────────────────────┬──────────────────────────────────────┐
│ Linear · {ws}  [Projects]│  (detail — LinearIssuePanel pane)     │
│ ┌─────────────────────┐  │  ENG-123  Title                       │
│ │ ENG-123 Title  ·[+ws]│  │  [state] assignee    Open in Linear ↗ │
│ │ ENG-124 Title   done │  │  description (markdown)               │
│ │ ENG-125 Title …      │  │  Activity Log …                       │
│ └─────────────────────┘  │  Comments … + composer                │
│                          │                                        │
└─────────────────────────┴──────────────────────────────────────┘
```

- **Left:** the existing issue list. Row click now **selects** (opens detail on the right)
  instead of promoting. A hover-revealed `+ ws` button on each row does the promote.
- **Right:** `<LinearIssuePanel variant="pane" target={{ identifier, connectionId }} />`,
  reused as-is. When nothing is selected, show a placeholder (mirrors GitHub's empty `<Acorn/>`).

### Selection state: local signal, not routing

GitHub PRs are deep-linkable (`/:owner/:repo/:number`); Linear issues are **not** — the browse
lives at the Source route and there is no per-issue route. Adding one is out of scope and not
needed for this UX.

→ Use a local signal `const [selected, setSelected] = createSignal<LinearProjectIssue | null>(null)`.
Row click sets it; the detail column reads it. Session-only, not persisted across relaunch —
consistent with the existing per-workspace session restore model (editor scroll, active
terminal tab are all session-only). If deep-linking is wanted later, promote to a route param
then.

`// ponytail: local selection signal, add a route param only if issues need deep-linking`

### Reusing `LinearIssuePanel`

Pass the issue's `integrationId` as `connectionId` so the detail fetch is scoped to the right
connection (`GET /api/linear/issues/:identifier?integration=…`) instead of the multi-connection
resolve fallback. The pane variant already renders the section header with "Open in Linear ↗"
and has no close button (it's meant to live in a layout slot) — perfect here; changing the
selection swaps the issue, and the empty state is just "no selection".

Required props and what to pass:

- `target={{ identifier: sel.identifier, connectionId: sel.integrationId }}`
- `variant="pane"`
- `onClose={() => setSelected(null)}` — harmless; pane variant doesn't render a closer, but the
  prop is required. (Optional: wire a back/clear affordance to it.)
- `onContentClick={() => {}}` — no-op. In the PR overlay this intercepts in-body link clicks;
  the browse doesn't need that. `// ponytail: no-op, add ref-navigation only if asked`

## Concrete changes

### `LinearBrowse.tsx`

1. Change the outer shell from `<main class="panes panes-empty">` (single column) to a
   two-column layout. Reuse the existing pane classes:

   ```jsx
   <main class="panes linear-browse-panes">
     <section class="pane pane-left linear-browse">
       … section-header + list …
     </section>
     <section class="pane pane-right">
       <Show when={selected()} fallback={<div class="pane-empty"><p class="placeholder">Select an issue.</p></div>}>
         {(sel) => (
           <LinearIssuePanel variant="pane"
             target={{ identifier: sel().identifier, connectionId: sel().integrationId }}
             onClose={() => setSelected(null)} onContentClick={() => {}} />
         )}
       </Show>
     </section>
   </main>
   ```

2. Row: split select vs. promote.

   ```jsx
   <li>
     <button type="button" class="linear-browse-row"
             classList={{ active: selected()?.identifier === it.identifier }}
             onClick={() => setSelected(it)}>
       <span class="linear-browse-id">{it.identifier}</span>
       <span class="linear-browse-title">{it.title}</span>
       <Show when={it.state}>{(s) => <span class="linear-browse-state" style={{ '--state-color': s().color }}>{s().name}</span>}</Show>
       <button type="button" class="linear-browse-ws-btn" title="Open as task"
               onClick={(e) => { e.stopPropagation(); void promote(it) }}>+ ws</button>
     </button>
   </li>
   ```

   Note: nesting a `<button>` inside a `<button>` is invalid HTML — GitHub gets away with it
   because its row is an `<A>`, not a button. Make the **row a `<div role="button">`** (or a
   plain `<div>` with `onClick` + `tabindex`), keeping the real `<button>` for `+ ws`. Match the
   GitHub keyboard affordance: row is focusable, `+ ws` reveals on `:focus-within`.

3. `promote(it)` is **unchanged** — it already creates the task, `activateTaskSignals(w, {pane:'linear'})`,
   and navigates away. It just moves from the row's `onClick` to the `+ ws` button's `onClick`.

4. Keep the whole project-picker block (`openPicker`, `savePicker`, overlay JSX) verbatim.

### CSS (`task-view.css`, near the existing `.linear-browse` rules ~L167)

- One grid rule for the two-column shell:

  ```css
  .panes.linear-browse-panes {
    grid-template-columns: clamp(320px, 28vw, 420px) minmax(0, 1fr);
  }
  ```
  (Mirrors the PR left-column clamp. `.pane-left`/`.pane-right`/`.pane` classes already give the
  flex-column + borders + scroll behaviour.)

- Hover button, copied from `.pr-ws-btn`:

  ```css
  .linear-browse-ws-btn {
    flex: none; opacity: 0; font: inherit; font-size: var(--fs-sm);
    color: var(--text-muted); background: transparent;
    border: 1px solid var(--border); border-radius: var(--radius); padding: 0 6px; cursor: pointer;
  }
  .linear-browse-row:hover .linear-browse-ws-btn,
  .linear-browse-row:focus-within .linear-browse-ws-btn { opacity: 1; }
  .linear-browse-ws-btn:hover { background: var(--bg); color: var(--text); border-color: var(--border-strong); }
  ```

- Add `.linear-browse-row.active { background: var(--bg-selected); border-left: 3px solid var(--accent); }`
  for the selected row (mirrors `.pr-row.active`).

## Behaviour being removed / changed

- **Removed:** whole-row click = create task. Row click now selects. `title="Open as task"`
  moves off the row onto the `+ ws` button.
- **Removed:** `<main class="panes panes-empty">` single-column shell for this pane.
- **Kept:** `promote()`, the project picker, all queries, `LinearIssuePanel` (reused).
- **Nothing else in the Linear client is obsoleted.** `LinearIssuePanel`'s other two call
  sites (PR-detail overlay, task-view pane) are untouched.

## Deliberate simplifications (and when to revisit)

- **No virtualization** on the list. `PullList` virtualizes because open PR lists are large;
  the Linear list is only *active* issues in the workspace's linked projects (server filters
  out completed/canceled). Add `@tanstack/solid-virtual` only if a workspace's active-issue
  count gets big. `// ponytail: plain list, virtualize if lists exceed ~hundreds`
- **No `j`/`k` keyboard nav** initially. Cheap to add later by copying the command-registration
  block from `PullList.tsx` and having it call `setSelected` on the next/prev issue.
- **Selection is session-only**, resets on workspace/repo nav. Matches existing session-restore
  scope; persist per-workspace only if users ask.
- **No search/sort/filter** — none exists today; not part of this ask.

## Testing / verification

- `pnpm lint` (tsc) + `pnpm test`.
- Manual (`pnpm dev`): a workspace with ≥1 linked Linear project and ≥1 active issue.
  1. List renders on the left; clicking a row opens its detail on the right (title, description,
     activity, comments load; "Open in Linear ↗" points at the ticket).
  2. Hovering (and keyboard-focusing) a row reveals `+ ws`; clicking it creates a task and
     switches into the task's Linear pane — the old promote behaviour, unchanged.
  3. Selecting a second issue swaps the detail; the connection-scoped fetch (`?integration=`)
     is used (check the network tab).
  4. Empty state (no selection) shows the placeholder; project picker still works.
