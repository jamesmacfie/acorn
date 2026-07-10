# State and startup restore

Acorn classifies state by durability, scope, and ownership. The default for UI attention is
session state; persistence is reserved for arrangements the user expects to survive a relaunch.

## Durability tiers

| Tier | Meaning | Authoritative home | Examples |
| --- | --- | --- | --- |
| T1 | Rebuildable remote mirror | SQLite + sync engine | pulls, issues, checks |
| T2 | User-owned durable data | SQLite app tables | tasks, notes, memory, workflow runs |
| T3 | Persisted view arrangement | versioned persisted-state descriptors | layout, editor tabs, filters, theme |
| T4 | In-session attention | scoped Solid signals | scroll, selection, maximize, active terminal |
| T5 | Live process resources | main-process lifecycle services | PTYs, webviews, database pools |

Scopes are `app`, `workspace(id)`, `task(id)`, and `pane(taskId, paneId)`. Each state owner is the
only writer. Server data is never copied from TanStack Query into a second signal store.

## Restore pipeline

`persistence/startupRestore.ts` restores registered `PersistedStateSlice` descriptors in three
ordered phases:

1. `workspace`: shell identity and application preferences.
2. `view`: active task/source, notices, and workspace filters.
3. `panes`: pane layouts and editor tabs.

The pipeline waits for IndexedDB cache restoration plus the repo/task lists, hydrates every phase,
emits `boot:restored`, and only then arms throttled writes. This hydrate-before-persist rule prevents
startup defaults from overwriting saved state. Restore duration is recorded as the
`acorn:restore` performance measure.

Registry membership remains live after boot. A descriptor registered by a lazily activated plugin
hydrates against the current prefs snapshot before its first persistence pass. Removing a descriptor
stops observation without deleting its stored values; re-registering it hydrates again, so plugin
disable/enable cycles preserve arrangement.

App-scope descriptors use their declared key. Workspace/task/pane descriptors derive canonical
keys by appending the encoded scope id, for example `core:task-layouts:task%2Fid`. The old aggregate
`task_layouts`, `task_panes`, `editor_open_files`, and `pr_filters` values remain read-only migration
inputs. Once canonical scoped values exist they win, and subsequent writes stay scoped.

## Descriptor contract

Every T3 slice declares a stable key, scope, restore phase, schema version, codec, empty value,
unknown-id policy, and byte limit. Feature stores provide only typed `values()` and `hydrate()`
bindings. Codecs validate stored `unknown` values and serialize durable arrangement only. Layout
codecs retain unknown pane ids inert so temporarily disabled contributions are not destroyed;
the selected-source store likewise retains unknown source ids until the user explicitly chooses a
different source. Enumerated filters drop invalid values. Pane maximize and editor dirty contents
are intentionally not serialized.

Writes go through `savePref`, which updates the shared `prefs` query optimistically, serializes
writes per key, and identifies each optimistic attempt by revision so an older failure cannot roll
back a newer equal-value write. Failed writes create a visible background-error notice. Oversize
descriptor values are refused before the request and also create a notice (the notices slice itself
logs because it cannot report failure by persisting another notice).

## Preference and local-storage audit

`persistence/prefKeys.ts` is the renderer's complete preference vocabulary.

| State | Classification | Restore/ownership decision |
| --- | --- | --- |
| Theme keys, `left_collapsed`, keybindings, `rail_order`, terminal defaults/height, `diff_view`, `onboarded`, agent-tool permissions | T3 app view state | Descriptor-declared; reactive settings write through `savePref` |
| Last path/task/source | T3 app view state | Ordered shell descriptors |
| Task layouts and editor tabs | T3 task state | Scoped descriptors; weights/pins persist, maximize/dirty content do not |
| PR filters | T3 workspace state | Scoped GitHub descriptor |
| Notices | T3 bounded app state | Descriptor capped at 50 notices and 64 KiB |
| `task_panes` and `pane_shortcuts` | Legacy read/fallback | Retained for compatibility; new state uses layouts and keybindings |
| Per-workspace last in-session view, active terminal, focused/maximized pane, recipe browser URL | T4 | Signals only; evicted with their task/workspace |
| Pull-detail `<details>` open state | Deliberate localStorage exception | Per-device micro-preference; synchronous hydration avoids disclosure flash |
| Comment/reply drafts | Deliberate localStorage exception | Per-device draft recovery; cleared on successful submit |
| Tasks, workspaces, provider records, notes, workflow runs | T2 server state | Never prefs/localStorage |
| File bodies and patches | T1/T5 reconstructable cache data | Excluded from IndexedDB dehydration |

## Eviction ownership

Task archive and workspace removal emit lifecycle events only after the durable mutation succeeds.
For an active task, the task-id-keyed UI scope disposes first and the archive event performs the
final eviction, preventing cleanup from repopulating cursor/editor state after eviction.
`persistence/scopedEviction.ts` maps those events to owner-provided eviction functions. It clears
task layouts, recipe URLs, terminal open/max/active state, pane focus/maximize, editor tabs and
Monaco view state, pending presentation intents, per-workspace view memory, and PR filters. The
persistent bindings then write a scoped tombstone so legacy aggregate values cannot resurrect the
evicted scope. Preview webviews keep their existing
feature-owned subscriber and tear down their guest process on task archive.
