# Unit 17 coordinator review brief

Source review on October 1, 2026. Read reports 12 and 15 and reviewed units 02, 03, 08, 16. Start
after preceding units pass coordinator review. Preserve editor custody while reducing search and
viewport work.

## Incremental ripgrep and cancellation

`searchInFiles` currently buffers all stdout through execFile before parsing, caps only the response,
and converts every process error to an empty success. Parse owned chunks incrementally, retain the
accepted 2,000 hits plus evidence of another supported hit, then stop the owned producer and join
actual exit. Exactly 2,000 hits with no additional supported match is complete, not automatically
truncated. Unsupported non-UTF-8 path/line events retain their established policy and do not count
as an extra accepted hit. Preserve grouping/order, previews, case/word/regex options, ignore behavior,
UTF-8 byte-to-UTF-16 column conversion, and the task-to-root authorization boundary.

Distinguish exit 1/no matches from exit 2/invalid regex, launch failure, timeout, overflow, and caller
cancellation. A producer stopped because truncation is proven must return its deliberate bounded
result, not classify its own signal as an execution failure. Bound stderr and partial JSON records,
settle startup/error/end/abort races, and clear every timer/listener. Chunk boundaries can split UTF-8
characters and JSON records. Propose the single-record policy explicitly: an arbitrary small record
cap or rg max-columns flag must not silently lose previously supported minified-line matches or
change their exact columns. Oversized/invalid records need truthful failure, never empty success.

Capture the panel's Node/task/query generation and forward cancellation through client transport,
route/capability, and actual process owner. Raw AbortSignal is not a serializable RPC object; unit 02
supports forwarded Requests, and unit 10 may introduce another explicit lifetime seam. Verify the
compiled and loaded Node paths before choosing the contract. Promise.race or discarded results alone
do not prove the ripgrep child exits. Superseded input/toggles and pane disposal abort only their own
request; a hypothetical shared reader must preserve its sibling. Cancel the debounce and guard the
deferred focus microtask. Hidden SearchPanel intentionally retains its query/results; hiding alone
is not an instruction to clear or cancel valid state.

## File tree viewport and freshness

FileTree already projects a stable keyed collection, but omits Rows.virtual and placement. Use the
portable kit viewport and pass offsets/heights to TreeRow, consuming unit 08's stable row identity.
Preserve keyboard focus/active descendant, expansion, selection, density, double-press promotion,
reveal scrolling, and the TUI projection. Avoid a private DOM virtualizer or unmeasured incremental
tree index. A zero-height first frame and hidden/restored pane need bounded admission and correct
reveal when geometry arrives.

Cached listings survive collapse but need revalidation. Capture Node/task/directory and generation;
join matching reads and let stale completion clear only its own in-flight entry. Worktree changes,
reconnect, and focus refresh affected loaded listings without eagerly walking every unopened folder.
If an event has no path, use an explicitly documented conservative refresh policy. Preserve a
previous success on transient failure and show a retry/error state, not an authoritative empty
directory. Retained open branches rebuild in parent order. A stale reveal chain must check its
revision after each await before opening more folders, scrolling, or acknowledging a newer reveal.

## Graphical state admission

The TUI cannot mount a graphical Rectangle, yet EditorPane warm-up can fetch and construct full
CodeMirror state before that fact is checked. Gate graphical imports/grammar/state work at the host
capability and actual surface admission seam. Preserve terminal $EDITOR sessions, explicit text/file
APIs needed by other features, and dirty recovery supplied by unit 16. Do not fabricate graphical
state or document handles under the cell renderer, and do not use typeof window as the entire host
contract. The TUI can have emulated or partial globals. Both retained pool ownership and undrawn
state construction need actual host tests.

## Evidence

Use fresh cumulative before artifacts under a verified single-runtime browser config. Real disposable
ripgrep fixtures at 2,000/8,000/100,000 matches must produce exact first hits, truthful truncation,
bounded retained stdout, and zero remaining child PIDs. Cover empty/no-match, invalid regex, rejected
root, long line, Unicode/chunk splits, missing executable, timeout, pre-abort, replacement, and held
route/loaded-worker cancellation. Actual FileTree/Rows tests cover 201/2,001 entries with bounded
DOM, preserved row identity, geometry, keyboard/reveal, stale listings and old read failures. Actual
TUI composition must construct zero undrawn CodeMirror states for a 1.5 MB remembered file while
the supported terminal editor path still works. Report Node/DOM/cell measurements separately from
native latency. Coordinate native verification after asset staging.
