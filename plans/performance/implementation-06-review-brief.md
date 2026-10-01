# Unit 06 coordinator review brief

Source review on October 1, 2026. This supplements reports 03 and 16; it does not authorize starting
unit 06 before unit 05 completes coordinator review.

Before accepting a fresh cumulative browser baseline, correct or verify the area03/16 probe
QueryClient module resolution. Their directory alias can select CommonJS and a second Solid runtime,
as unit 05 demonstrated. Record single-runtime identity and normal reactive provider/slot construction.
Keep original audit artifacts intact and supersede affected owner claims with matched working probes.

Keep bundle module lifetime distinct from mounted slot authority. The current worker owner stores
one `FrameBridge` and one bridge port in `Live`, constructed only by the first acquire. Both desktop
and TUI `RemoteTree` closures capture that first slot's QueryClient, document grant, focus container,
and Node. Later calls to its live scope accessor do not make those other captures safe. A retired
slot must release its listeners, pending requests, authority, ports and references without stopping
a surviving sibling or multiplying bundle workers.

The framework-free SDK already has `TreeRender(bridge, mount)`. Investigate using that existing
argument for the bridge belonging to each mount before inventing a new public surface. Its current
`runTreeChannel` passes one global bridge to all renderers; `mountTree` and `connect()` share a
module-level memoized handshake. Frame `connect()` remains legitimate because a frame owns one
port for its whole lifetime. A tree module-global connection cannot silently borrow the first,
focused, newest, or only currently drawn slot's authority: async continuations can outlive all those
conditions.

First-party service helpers need tracing too. `plugins/http/src/tree/httpClient.ts` and
`plugins/database/src/tree/databaseClient.ts` call global `connect()` per operation, while their
tree entries use `solidTree`. Scope the captured service API at component/model construction, not
at delivery after an await. Search every loaded tree consumer, including delayed actions and
settings. A new host bridge alone does not fix helpers that still reach the global one.

Before implementation, return a concrete proposal for bootstrap versus mounted ports, protocol
version/old-SDK behavior, how first-party and framework-free consumers receive safe authority,
retirement and startup failure cleanup, and idle worker bounds. Preserve accepted bundle sharing
and warmed module state where safe. If legacy compatibility needs an authority-keyed fallback,
explain the identity, sharing, revocation, surviving sibling and idle pool limits explicitly. Do not
silently create one worker per tree or keep a retired document grant alive to preserve module reuse.

Use the unit 04 pure QueryClient ownership seam when capturing Node identity. Unit 05 supplies
atomic Node transitions and pane lifetime; do not undo those. TUI stdout/stderr draining belongs at
the Node worker factory owner and must permit a noisy worker to finish without writing into the
terminal screen or accumulating unbounded captured output. Worker creation, two channel creations,
bridge connection and handshake transfer form one startup transaction: failure at any boundary
must terminate the new worker and close every created port exactly once.

Generation checks also apply to an old worker's error callback and heartbeat: the current callbacks
call `stop(hash)`, which can target a replacement after the old generation retires. Retirement must
clear per-slot pending timers/handlers and prevent held replies from publishing into a replacement
slot with the same ID. A map membership check alone does not establish slot identity. Preserve
separate frame handshake behavior while changing tree bootstrap and mounted authority.

Proof uses the actual desktop and TUI hosts, SDK requests and real noisy worker factory. Cover
concurrent A/B equal task IDs, two documents, first-slot disposal with sibling surviving, warm
remount, held async requests, revoked document access, failure before/after transfer, grace and
heartbeat generations. Preserve frame closure cleanup and unchanged contribution identity gates
from report 03. Replaying only a hypothetical bridge comparator is insufficient.

## Layout and grant review

The source review identifies three related ownership checks before acceptance:

- A composed layout consumes its opening plugin selection once and passes that immutable initial
  selection to all regions. Subsequent routed scope and live selection updates retain their
  behavior. Modern shared model identity excludes the initial selection; full legacy context
  affinity includes it. This preserves HTTP list/detail selection and draft sharing.
- Registered layout construction captures the QueryClient's Node identity. Lazy iframe and
  document regions use that capture after ambient navigation changes. Explicit null denotes the
  serving origin. Other registered frame compositions use the same seam without calling hooks
  from delayed binding accessors.
- A structural document accessor owns an opaque grant generation. Initial null-to-first-handle
  readiness preserves that generation; withdrawal or replacement after admission advances it.
  The actual layout handle publication refreshes the generation even between plugin calls. A
  bridge from a retired generation permanently denies access and releases its local accessor.
  A legitimate later mount receives the replacement grant, including when a handle object returns.

The accessor registry uses weak keys; it must not become a strong visited-view cache. Document-free
layouts receive no document grant. Editor saving and recovery remain unit 16's responsibility.

The HTTP model reserves its first live bridge before constructing resources that immediately fetch
lists or read initial context. Failed setup rolls back that reservation. Shared model state and
read refresh can use an equivalent live lease; region actions capture their invoking bridge before
awaiting. A held detail action must survive retirement of the list region. Ordered save acknowledgement
and draft recovery remain unit 20's responsibility.

The task/pane presentation event bus still lacks Node identity. This preexisting limitation is
separate from captured bridge and service authority; do not claim the unit repairs every concurrent
cross-Node presentation event. Record a reproduced regression if layout capture changes that behavior.

The coordinator's initial deferred-heartbeat concern was a misread: the heartbeat writes the owned
tree MessagePort, not the TUI adapter. Its existing retirement deadline bounds queued pings. Any
clearer deferred construction deadline is an ownership change, not a measured performance gain.
