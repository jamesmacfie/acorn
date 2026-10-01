# Unit 27 coordinator review brief

Source review on October 1, 2026. Read areas06,07,15,16, docs/tui.md and caching.md, reviewed
units03–06 and26, then trace main/App/Shell/platform through the shared fleet and custody broker.
Use a production composition owner in fresh probes. Keep the startup roster deferred until after
the first frame and preserve the checked startup graph. No second QueryClient or TUI-only cache.

## Selected presentation and supervised process

main acquires/restores one opened-node partition, passes that client and Node permanently to App,
refreshes that client on recovery, and flushes it at quit. App supplies a fixed provider while the
navigation command changes activeNodeId. Compose the selected Node's provider, restore lease,
persistence, pane scope, status, telemetry preference, and recovery generation together. Unit 05
PaneModelHost belongs under the selected provider. Outgoing operations and cleanup retain their
captured origin. Retire old command registrations before replacements and prevent startup TaskArg
from selecting the same ID again on a later Node. A delayed A restore/recovery cannot publish into B.

opened.nodeId and opened.stop describe the process this TUI started. Keep that supervision identity
independent of selected presentation. Quit while viewing remote B drains supervised A and leaves B
running; an attached A stays running. Restart uses the owned local process and updates its endpoint
through custody, even while another Node is visible. Review nodeStarting: its global boolean must
not label remote B as starting just because supervised A is booting. Preserve confirmation meaning.

## Connection and retirement

platform initially connects only opened.nodeId; remembered remote selection must call the existing
authenticated fleet/custody seam before reads, preserving pinning and tokens outside the renderer.
Its nodeInterest is a deliberate no-op for this in-process, legacy TUI broker, not permission to
invent another event transport. Verify offline/retry, revoked/incompatible, forget/re-pair, and
late starting/restart completions after disposal. No owner can recreate a broker connection after
quit or leak a replacement child. Extend only reproduced lifecycle holes; preserve unit10 process
ownership repairs. Dispose recovery roots/watchers where their actual owner requires it.

## Cache and terminal host

Acquire each selected partition through unit04's public lease and restore; flush/release captures
the original adapter. Clean switching must not create captures, writes, or another persistence
clock. Dirty outgoing work survives to its original write. Reacquisition and late retirement obey
the shared barrier. Preserve the TUI's intentionally limited restored slices and file modes/atomic
rename. Notes/file/composer dirty custody follows the accepted owners; no reset or smaller cap.

Use fresh single-runtime resolution and a normal provider in the actual terminal renderer. Test
same task/entity IDs on two Nodes, cached B immediately, observer A0/B1, B refresh leaves A intact,
return A, delayed restore, offline cache, pane/draft return, structural task events, and scoped
remote-plugin requests. Active B preference controls telemetry, and footer/recovery uses B. Report
any unsupported terminal surface honestly rather than adding browser features during this unit.

Check task identity inside the selected partition too. `Shell.tsx` passes changing `model.task()`
through an unkeyed Match to `PaneBody`; `PaneRow.tsx` mounts a contribution inside an unkeyed Show
and supplies a reactive task getter. A registered loaded region captures immutable context at
construction. Reproduce A-task to B-task with the same pane entry before changing this path, then
retire/remount at Node/task/pane identity where necessary. Task metadata refreshes must preserve
the region. Prove context and API task origin through the actual shared-layout and SDK consumer,
not only a compiled model accessor. The desktop already keys TaskView by active task ID.

## Evidence

Start two disposable authenticated Nodes with synthetic data and the real platform/composition.
Measure restore/read/write/observer/command/frame owner counts through repeated A/B transitions,
reconnect, permission changes, forget/re-pair, and quit. Include active B persistence and restart
recovery. Run a disposable PTY or fake-TTY input/frame transcript with inspected cell output, then
check every owned process, listener, timer, worker, and lease is retired. Supervised and attached
process cases need separate assertions. Run relevant TUI startup, shell, keys, cache, node, plugin,
and architecture gates. Synthetic CPU/count results do not establish visible native latency or
several days of active use. Coordinate heavy/native probes and preserve all before artifacts.
