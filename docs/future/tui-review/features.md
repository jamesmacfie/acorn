# Feature inventory

Date: 2026-09-27. Status: review inventory, with verification still open.

This inventory follows [the product feature list](../../features.md) and the terminal roster in
`apps/tui/src/roster.ts`. "Live" means observed in the isolated PTY. "Test" means an automated
TUI test drives that behavior. "Code" means the path exists but was not exercised end to end.
None of those labels alone is terminal-only release acceptance. For each row, the final journey must
cover navigation, visible state, the principal action, failure, and recovery at both target sizes.

| User journey | Evidence | Finding and required acceptance |
| --- | --- | --- |
| Start, attach, and quit | Live, test, code | Startup failed on missing `pg` before repair. Verify a fresh `pnpm install`, first frame, cached startup, attach to an existing local Node, quit confirmation for a supervised Node, and no shutdown of a Node this client only attached to. |
| Pair and switch Nodes | Code, tests for broker and chrome | `--node` pairing happens before rendering; the palette can switch remembered Nodes. Verify fingerprint comparison, rejected codes, offline and revoked states, recovery, and the active Node label in a real two-Node session. |
| Workspaces and projects | Live, test | `w`, `p`, palette search, and return to prior workspace work in the fixture. Verify create, rename, add folder, project assignment, and recovery without desktop Settings. The current palette is navigation, not management. |
| Tasks and worktrees | Live, test for selection | Task opening and pane persistence work. Verify create, branch and worktree creation, task actions, archive and restore, parent and child groups, conflict errors, and keyboard access to every task marker label. A task must not require desktop to originate. |
| Archive and global search | Code | The Archive source and task search exist in client-core. Verify the source appears when applicable, opens a readable result, restores correctly, and keeps focus after the task roster changes. |
| GitHub browse and PR review | Tests, code | Tests render list, detail, and controls. Verify OAuth setup, repository selection, open and closed lists, checks, Actions logs, review threads, comments, labels, reviewers, viewed files, merge and draft actions, and create PR in a live connection. Check confirmation and result states for every write. |
| Diff navigation | Live Changes diff, tests | The 120 by 40 fixture showed a long diff and bounded list. Verify next file, find, context expansion, inline comments, annotation labels, end of document, and return to the same reading position. At 80 by 24, preserve file identity and full action names. |
| Changes, stage, commit, push | Live rendering, tests | The fixture shows tracked and untracked files, staging controls, commit editor, and remote bar. Verify stage and unstage, commit modes, generate message, amend, push or publish, errors, and post-action refresh in a disposable repository. Do not use the fixture's large diff as proof of writes. |
| Managed agents and Agent Center | Live list, tests | Tests drive opening a run, sending a turn, newline, approval, new run, and whole-word session actions. Verify real Claude and Codex sessions, queue, fork, compact, delegated child tasks, archive, search, usage, and failure or signed-out states. A stopped fixture session does not prove a running CLI. |
| Agent attachments, artifacts, export, handoff | Code review | The `files` seam is absent, so Attach, Export, and download can appear and do nothing. Continue in terminal can leave the managed pane without a reachable terminal drawer. Hide these until an explicit path or byte-stream alternative exists. Test full round trips and failure messages. |
| Raw terminals and run targets | Code review | The desktop drawer does not exist on this host, and the terminal plugin's session source has no typing panel. Palette Run and provider terminal commands need a terminal-native session chooser and PTY rectangle, including resume, exit, resize, and Escape. Verify against a real process. |
| Editor and file search | Tests, code | The tree, search, and read-only file box render; `$EDITOR` uses a PTY. Verify opening, editing, saving, external editor failure, file palette, search result navigation, and return focus. Make the handoff command visible in the pane. |
| Notes, memory, findings, context | Tests, code | Notes and context frames render, and memory is a rail source. Verify edits, inclusion toggles, proposals and review, findings history, context preview and budget, send to agent, and independent slow or failed sections. |
| Workflows | Code, tests of graph kit | The source, editor, run pane, and graph list have terminal projections. Verify create, edit, publish, run, gate approval, retry, scheduling and progress. A terminal-only user needs a settings route for defaults and schedules. |
| Docker | Live rendering, code | The fixture showed stopped containers and a filter, but the list mixed names and status at 120 columns. Verify project match, start, stop, logs, stats, exec PTY, and trust prompts. State the scope when Browse has no list. |
| HTTP requests | Code and shared plugin tests | Loaded tree draws in cells. Verify install and trust, create, auth variables, send, response inspection, save, and delete against a local test server. Check terminal text editing and readable request/response headers. |
| PostgreSQL browser | Code and shared plugin tests | Loaded tree draws in cells. Verify connection setup, schema, paging, cell edit, SQL execute, saved query, and error handling against disposable PostgreSQL. Never infer query execution from a rendered form. |
| Linear and Rollbar | Code and shared plugin tests | Descriptor lists and remote trees have a host adapter. Verify connection setup, filtering, item detail, task link and promotion, comments or context copy, and reference panels. Source promotion currently passes a no-op callback, so it needs a terminal task picker and confirmation. |
| Dashboards and data sources | Code review | Dashboard side panels are omitted from the terminal source projection, and rectangle slots show a muted line. Provide a full-width dashboard pane or a plain table/list projection when it carries decision data. Test data freshness and an empty panel. |
| Notifications | Test, code | Topbar count and `n` inbox have keyboard tests. Verify unread changes, cross-Node target navigation, toast timing, terminal focus notifications, and an offline target. The count should have a text legend in help. |
| Loaded plugins and trust | Tests, code | Custody, hash checks, trust prompt, worker failure, and descriptor/remote trees have tests. Verify install, update, disable, removal, contribution fallback, and readable trust differences through the TUI. A local-folder install needs a typed path or a clearly described omission. |
| Appearance, shortcuts, security, integrations, tools, schedules, and Nodes | Code review | Device config can be read from `acorn.json`, but the desktop Settings pages have no terminal home. Create terminal settings routes or documented commands for the operations needed to run the app alone. Verify persistence and validation. |
| Onboarding | Code review | The desktop overlay is not mounted in TUI. Verify a first run with no project or provider; offer an explicit terminal setup journey or clear command-line steps and an in-app route back to them. |
| Preview and host webviews | Code review | `preview` is gated off through the host seam. Keep it hidden and offer the URL as copyable text when a task depends on it. State which browser-based features require an external browser. |

## Cross-cutting acceptance for every applicable journey

- The user can find the route from the initial screen or `Ctrl+K`, identify the focused control,
  perform its action with a documented key, and return with Escape.
- Empty, loading, offline, unauthorized, error, and completed states use distinct words. A control
  does not remain pressable when the host cannot perform its action.
- At 80 by 24, the selected object's identity and primary action remain legible. At 120 by 40, extra
  width reveals detail rather than more decorative marks.
- A write shows the affected object, its result, and a recoverable error if it fails. Tests use
  disposable Node data and never assert success from the absence of an exception alone.

## Verify before building

- Compare the shipped source and pane registries with this table. New contributions need a row.
- Inspect each plugin's `when`, `requires`, and platform seam before hiding a control.
- Run the same seed in desktop and TUI to check data parity; record host-specific layout differences.
