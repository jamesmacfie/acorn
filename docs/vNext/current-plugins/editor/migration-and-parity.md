# Editor migration and parity

**Status:** Normative current-plugin migration<br>
**Requirement prefix:** `CUR-EDITOR`

## V1 coupling removal

| V1 behavior/coupling | Required V2 replacement |
| --- | --- |
| `taskRoot` and `resolveInRoot` called inside Editor | task/file resource broker |
| `git ls-files` spawned by plugin implementation | fixed core repository enumeration |
| ripgrep executable/process owned by plugin implementation | bounded core fixed-tool search import |
| in-app write lacks expected version | one optimistic `file.write@2` contract |
| open files persisted in shared `prefs` | Client-device plugin presentation slice |
| core `PaneIntent` union includes `editor:reveal` | namespaced typed navigation intent |
| app composition imports pane components directly | manifest contribution activation |
| Rollbar imports core pane event using Editor shape | declared Editor reveal contract |
| Editor imports Agent reference functions | optional `acorn/agents.reference.insert@2` |
| Monaco/diff setup is imported by feature consumers | allowlisted built-in renderer capabilities |
| task archive manually evicts Editor stores | core task lifecycle subscription |
| separate internal and `/api/v1` Editor routes | unified V2 queries/commands |

`CUR-EDITOR-120` No core, Agents, Rollbar, Changes, Database or other plugin module may import an
Editor implementation, model or component. Renderer use, reveal and references cross declared
contracts only.

`CUR-EDITOR-121` V2 creates no Editor Node database and imports no V1 preference. V1
`editor_open_files`, tree/view state, cached search results and dirty text are left untouched.

`CUR-EDITOR-122` The V2 Client starts with no tabs for every task. Layout compatibility may retain
the namespaced Editor/Search pane IDs only inside the new V2 Client store; it does not parse V1
preference values.

## Fresh-install sequence

1. Installer verifies and atomically activates compatible Node/declarative artifacts against
   Electron's built-in renderer allowlist.
2. Electron registers renderer capabilities, two pane descriptors, the file overlay, commands,
   shortcuts and reveal intent.
3. Opening a task resolves its core checkout resource and renders the lazy root.
4. `Cmd+P` queries authorized files; selecting one opens a preview tab.
5. First edit promotes the tab; autosave commits with expected revision.
6. Search uses the Node companion and a result reveals the matching file beside Search.

`CUR-EDITOR-123` Fresh start requires no wizard, secret, provider login, terminal session or Agent
session. A missing checkout is corrected through core task recovery, not by instructing the owner
to open Terminal.

## Exact visual and behavioral parity

`CUR-EDITOR-124` Editor and Search appear in the task pane switcher with V1 labels, glyphs, order,
minimum width and default shortcuts; standard show/add/close/pin/move/resize/equalize/focus/maximize
behavior is unchanged.

`CUR-EDITOR-125` Editor retains a left lazy tree, right tab bar, one code surface, theme-following
syntax/chrome, directory-first ordering, exclusion of `.git` and dependency directories, active
file highlighting and reveal-active-file behavior.

`CUR-EDITOR-126` Single-click tree/quick-open produces one italic ephemeral tab; double-click or
editing promotes; a dirty preview is never replaced; closing chooses the same neighboring tab.

`CUR-EDITOR-127` Autosave retains the 1,500 ms delay and flushes on `Cmd+S`, blur, switch and close.
The V2 conflict UI is an intentional safety enhancement and MUST NOT remove or silently replace the
owner's dirty model.

`CUR-EDITOR-128` Clean files update after external Agent/tool/editor changes. Dirty files remain
untouched and visibly conflicting. Cursor/selection/scroll and tree expansion survive pane/task
navigation during the session.

`CUR-EDITOR-129` Open paths and active tab survive a Client relaunch with dirty reset, within the
32 KiB bound. File bodies, dirty buffers, selection and absolute paths do not persist.

`CUR-EDITOR-130` `Cmd+P` opens the same accessible overlay, returns at most 100 visible fuzzy
matches and opens the selection as an ephemeral Editor tab in the active task.

`CUR-EDITOR-131` Search retains a 200 ms text debounce, case/whole-word/regex buttons, grouped file
results, counts, line numbers, highlighted matches, truncation indicator, double-click mouse
navigation and single assistive activation.

`CUR-EDITOR-132` Search semantics preserve ignored/hidden/binary defaults, 2,000 total-match
ceiling and 10-second deadline. V2 deliberately surfaces invalid regex and execution errors instead
of misreporting them as zero matches.

`CUR-EDITOR-133` “→ agent” retains whole-file or selected-line reference insertion and inline
failure feedback when Agents is installed. Its absence produces a clear optional-dependency state.

`CUR-EDITOR-134` A missing Node renderer counterpart, offline remote Node, permission denial,
deleted file, lost checkout, unsupported encoding, oversized file, save failure and plugin crash
each render distinct standard states while the shell remains usable.

## Clean-start, uninstall and rollback

`CUR-EDITOR-135` V1 files themselves are ordinary repository state and remain present because V2
does not touch V1 worktrees. The V2 configuration importer does not copy Editor state or infer V2
tasks from open V1 tabs.

`CUR-EDITOR-136` Removing Editor first blocks or resolves dirty buffers, closes its view sessions,
removes renderer/contribution registration and presentation slices, and preserves every worktree
byte and core file event.

`CUR-EDITOR-137` Reinstall restores unavailable layout positions and starts with no discarded
buffers. Compatible retained tab metadata may be restored only when the owner chose retention and
the same Node/task generation still exists.

`CUR-EDITOR-138` Update rollback restores a mutually compatible Node/client pair. Because Editor
has no Node schema, rollback never modifies worktree content; incompatible Client state is dropped
after dirty-buffer resolution.

## Fleet, offline and failure cases

`CUR-EDITOR-139` Tabs, searches and file identities are partitioned by Node. Identical task IDs,
repository names or paths from different Nodes never share models, view state or cache keys.

`CUR-EDITOR-140` Disconnect makes open remote files read-only and visibly stale, cancels unsent
saves/search, preserves dirty Client text, and never queues a write for later automatic delivery.

`CUR-EDITOR-141` Reconnect fetches current task generation and file revisions before enabling
write. A changed revision enters conflict; an unchanged revision may resume autosave only after an
owner-visible reconnection state settles.

`CUR-EDITOR-142` Event replay gaps clear Node-derived tree/search/revision projections, retain
Client dirty buffers separately, fetch authorized snapshots and then resubscribe from their
sequence.

`CUR-EDITOR-143` Capability revocation immediately disables read/write/search as applicable. It
does not expose previously cached sensitive content to a different device, Node, task or plugin.

## Release acceptance

`CUR-EDITOR-144` Contract tests compare root/list/files/read/write/search behavior against V1
fixtures while enforcing V2 revisions, explicit errors, pagination and path hardening.

`CUR-EDITOR-145` UI parity tests compare fresh V1 and V2 tasks for pane placement, shortcuts, file
tree, preview/promotion, tabs, autosave, view restoration, quick-open, search and Agent reference.

`CUR-EDITOR-146` Race tests cover late file loads, typing during save, external change during save,
task switch, checkout replacement, archive during write, disconnect during write and update with
dirty buffers.

`CUR-EDITOR-147` Security acceptance covers traversal/symlink races, malicious filenames/content,
regex and fixed-tool injection, renderer XSS, huge files/results, cross-Node reveals and
confused-deputy Agent calls.

`CUR-EDITOR-148` Boundary tests reject direct cross-plugin imports, core database access, absolute
path transport, arbitrary process/network/secret access, unconditional write, plugin executable
code in the app origin and activation of a renderer absent from Electron's allowlist.

`CUR-EDITOR-149` Editor is complete only when every V1 route, bridge method, contribution,
shortcut, persistence slice, client event, state transition and error path has a V2 mapping or
explicitly documented safety removal in these five files.
