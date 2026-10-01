# Unit 22 coordinator review brief

Source review on October 1, 2026. Read area 13, docs/shell.md host-owned webviews, preview owning
docs and reviewed process/Node custody work. Native child-webview retention/navigation remains
conditional; this unit repairs tunnel and URL-resolution ownership, not that separate product policy.

## Listener admission and retirement

PreviewTunnels joins same-key opening calls but counts only published entries against the 16 cap.
Reserve distinct Node/task/port admission synchronously before the first await. Pending plus live
owners count toward the bound; settle failed/retired candidates and close their actual listeners
and accepted sockets before they can publish port/secret events. Permanent dispose refuses later
opens. closeFor must retire matching pending and live owners. Old finally/error/idle callbacks must
target entry identity, not a replacement sharing its string key. A listen failure must not leave a
server/reservation, and old socket-close activity must not arm an unrelated replacement's timer.

Preserve same-key joining, independent Nodes/tasks, per-connection fresh pinned Node resolution,
loopback binding/target classification, ephemeral constant-time secret authentication, main-only
secret delivery, cookie/header envelopes, request deadlines/size bounds, complete head/body bytes,
stream backpressure and 60 s idle closure. Never return an original remote localhost URL on failed
rewrite. Capture the originating Node in tunnelUrl and closeTunnelsForTask and PreviewTaskPane's
read/cleanup generations; A close cannot match a same-ID B task or publish A's URL into B.

## URL waves

createPreviewUrlRuntime.forTask currently resolves each caller independently; refresh publishes
after awaits even if disposed. Join overlapping matching task/current-generation resolution only.
Recipe selection, project config and run-target changes must invalidate that wave and admit fresh
resolution through the existing priority ladder. Do not cache a script URL longer to reduce work.
Retired/disposed operations cannot update observed state or emit URL-changed events. Old finally
cannot remove a replacement. Define behavior for the originating stale caller explicitly and guard
UI publication; no retired candidate should be reused as current authority.

Trace preview node activation subscriptions, task archive/removal and project refresh. Independent
tasks stay independent. If process cancellation is used, one joiner's departure cannot abort a
surviving valid reader; use the reviewed process capability seam and actual exit cleanup. Bound
project-refresh concurrency only with a fresh measured workload. Keep trusted script configuration,
worktree/project confinement, execution environment, 10 s timeout, output rules and run-target seam;
no cross-plugin internal import or helper-specific preview shortcut.

## Evidence

Actual disposable loopback listeners: 24 concurrent keys publish at most 16, eight same-key callers
one listener, close/dispose during listen leaves zero listeners and no opened secret event, listen
failure then healthy retry, replacement/idle/socket/error races and permanent-dispose rejection.
Verify owned ports/PIDs gone. Never print tunnel secrets or private Node credentials. Eight matching
URL script readers one process wave; recipe/config/run-target changes held across old completion;
post-dispose zero events; independent tasks; process failures/deadlines with synthetic repositories.
Capture fresh paired production-owner counts/hash artifacts, focused suites/types/lint and docs.
Coordinate main-renderer preview URL/failure transitions with the coordinator; the driver does not
control child-webview navigation, so state that remaining native-surface limit honestly.
