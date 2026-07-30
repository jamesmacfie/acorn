# Preview contracts, events and security

**Status:** Normative current-plugin migration<br>
**Requirement prefix:** `CUR-PREVIEW`

## Node queries and commands

| Contract | Kind | Commit/result |
| --- | --- | --- |
| `acorn/preview.configuration.get@2` | query | effective and layered safe settings |
| `acorn/preview.configuration.update@2` | command | plugin setting revision |
| `acorn/preview.rules.list@2` | query | authorized rule snapshots |
| `acorn/preview.rules.upsert@2` | command | rule create/update |
| `acorn/preview.rules.delete@2` | command | rule tombstone |
| `acorn/preview.target.resolve@2` | cancellable query | target descriptor and policy |
| `acorn/preview.view.bind@2` | command/saga | short-lived Client/view lease |
| `acorn/preview.view.unbind@2` | idempotent command | lease revoked |

`CUR-PREVIEW-080` Configuration and rule mutations require expected revision and idempotency key.
View bind requires task URI, Client device ID, renderer capability descriptor, target revision and
owner-selected presentation session.

`CUR-PREVIEW-081` Resolve returns target ID, sanitized display URL, navigation policy, reachability,
optional tunnel requirement, source/revisions and expiry. Tunnel tokens and secret fill values are
never present in ordinary query results.

`CUR-PREVIEW-082` Errors distinguish `not_configured`, `configuration_untrusted`,
`legacy_script_unsupported`, `dependency_unavailable`, `target_stopped`, `target_unreachable`,
`command_failed`, `command_output_invalid`, `navigation_denied`, `view_unavailable`,
`view_not_owned`, `stale_view`, `permission_denied`, `cancelled` and `deadline_exceeded`.

## Client-native view protocol

| Operation/event | Direction | Required identity |
| --- | --- | --- |
| `view.ensure` | Client host internal | binding, target/policy generation |
| `view.bounds|show|hide` | renderer host → native adapter | owner window + view session |
| `view.navigate|back|forward|reload|stop|home` | host → native adapter | binding + operation grant |
| `view.state.changed` | native adapter → host | binding + monotonically increasing view sequence |
| `view.destroy` | either host/native lifecycle | binding |
| `browser.snapshot|click|fill|capture|console` | authorized Node command → selected Client | delegated Agent/owner authority |

`CUR-PREVIEW-083` Every native payload is strict-schema validated, bounded and correlated to the
owner BrowserWindow, Client, Node, task, binding and policy generation. Raw `webContents`, debugger,
window, DOM and filesystem handles never cross.

`CUR-PREVIEW-084` Node-to-Client browser commands use the authenticated Node event/stream session
as request transport with explicit response, 30-second default deadline, cancellation and one
selected Client. They are not product events and are not replayed after disconnect.

`CUR-PREVIEW-085` A Client may refuse a command because the view is hidden, origin changed,
approval is absent, policy expired, user is typing, debugger is unavailable or capability limits
changed. The Node returns the refusal without retrying against another Client.

`CUR-PREVIEW-086` V1 `window.acorn.preview`, service RPC preview/browser methods, and
`/api/v1/plugins/preview` endpoints are replaced by these contracts. No raw IPC channel, task ID,
public token or presentation-control compatibility bridge remains.

## Events

Preview publishes:

| Event | Safe payload |
| --- | --- |
| `acorn.preview.configuration.changed.v2` | configuration URI/revision/source, no URL value |
| `acorn.preview.rule.changed.v2` | rule URI/revision/enabled/action class, no selector/value |
| `acorn.preview.target.invalidated.v2` | task URI, target ID, reason class |

It subscribes to exact core task/repository/config/permission events and optional Terminal
`run-target.started|stopped|url-changed` events declared by that dependency.

`CUR-PREVIEW-087` Current URL, browsing history, page title, console, accessibility tree,
screenshot, selector, fill value, tunnel token and command output MUST NOT enter durable events.

`CUR-PREVIEW-088` Native view state is ephemeral Client protocol, not a durable plugin event.
Events invalidate target/config snapshots but never authorize a native action.

`CUR-PREVIEW-089` Event replay gaps fetch configuration/rule/active-task target snapshots, discard
expired bindings and resubscribe. Electron views are re-bound explicitly; they are never recreated
solely from replay.

## Exported capabilities and dependencies

`CUR-PREVIEW-090` Preview exports `target.resolve@2`, `view.open@2`,
`browser.snapshot@2`, `browser.navigate@2`, `browser.click@2`, `browser.fill@2`,
`browser.screenshot@2` and `browser.console@2` through the broker with exact schemas and risk.

`CUR-PREVIEW-091` Agents is an optional consumer, not a provider of Preview authority. Each call
preserves original Agent session, turn/tool request, owner policy, task and selected Client.

`CUR-PREVIEW-092` Terminal is an optional provider of `run-targets@2`. Preview cannot call
Terminal's start operation unless the original layout/owner request delegated it; Preview's broader
read grant cannot be substituted.

`CUR-PREVIEW-093` Configured command resolution consumes core process/config capabilities, not
Terminal. Browser rules consume core credential broker only for declared `fill-secret` operations.

## Threat controls

`CUR-PREVIEW-094` Threats include malicious Node, Client, plugin, repository config, page,
redirect, DNS answer, tunnel peer, Agent, CDP payload, archive/update and lost paired device.
Controls map to the security conformance suite.

`CUR-PREVIEW-095` Target policy revalidates scheme, user-info, normalized host, port, DNS/IP class,
redirect and tunnel destination. Non-HTTP schemes, metadata endpoints and unauthorized
loopback/private/link-local destinations fail closed.

`CUR-PREVIEW-096` A Node may authorize its own local/private development endpoint, but the grant is
task/target-specific and cannot be used as SSRF into other Node services. Client-local private
destinations require a separate explicit policy.

`CUR-PREVIEW-097` Guest requests carry no Acorn cookie, bearer ticket, client certificate,
marketplace credential or credential-broker header. The preview/tunnel origin is isolated from the
Acorn UI origin and from every other view.

`CUR-PREVIEW-098` Page content cannot send Acorn IPC, navigate the shell, open windows, register
service workers outside its ephemeral partition, request native permissions, read shared storage
or learn internal Node addresses beyond ordinary page-visible data.

`CUR-PREVIEW-098A` Remote operation implements `CON-PREVIEW-005` through `CON-PREVIEW-009`:
preview-specific AsyncAPI frames, selected-device/view/task/
target/origin-generation binding, exact local Host/Origin/token checks, closed
header/method policy, redirect/DNS reauthorization, terminal acknowledgement
and verified service-worker/cookie/cache/partition teardown. A generic stream
URI alone cannot open or authorize a preview.

`CUR-PREVIEW-099` CDP attaches only to the selected guest and is detached on teardown. Methods are
an exact allowlist; `Runtime.evaluate` and arbitrary `executeJavaScript` are not exposed to plugins
or Agents.

`CUR-PREVIEW-100` Accessibility names/values, console and screenshots are untrusted sensitive
page data. They are size-bounded, redacted where feasible, returned only to the authorized call and
excluded from logs, events and crash reports.

`CUR-PREVIEW-101` Fill input is capped, rendered in owner approval according to sensitivity and
never echoed for secret fills. A click/fill ref becomes invalid after navigation, snapshot
replacement, DOM epoch change or policy change.

`CUR-PREVIEW-102` Detached DevTools requires owner gesture and cannot attach to the Acorn shell or
another task's guest. Closing/disable/update also closes DevTools.

`CUR-PREVIEW-103` Browser rules cannot broaden target policy, suppress chrome, invoke an Agent
tool, call plugin capabilities or persist page-derived data.

## Acceptance

`CUR-PREVIEW-104` Contract tests cover configuration modes/precedence, rule CRUD, optimistic
concurrency, target expiry, binding ownership, native state sequencing, command refusal,
dependency absence, event replay and teardown.

`CUR-PREVIEW-105` Security tests cover URL parser ambiguity, user-info, redirects, DNS rebinding,
SSRF/private ranges, tunnel substitution, cookie/storage isolation, popup/protocol/permission
attempts, shell/command injection, selector/value injection and CDP method escape.

`CUR-PREVIEW-106` Multi-Client tests prove a Node command cannot drive the wrong Client/view,
fallback to another owner device or reuse a binding after disconnect.

`CUR-PREVIEW-107` Provider tests prove a Node/plugin cannot substitute Electron code and that wrong
declaration digest, non-allowlisted renderer, incompatible major/platform capability, quarantine
or absent sandbox fails closed.

`CUR-PREVIEW-108` Audit records configuration/rule mutations, view binds, Agent browser actions,
secret use, native DevTools and denials with identities/origin classes but no full sensitive URL
query, page content, console, screenshot or secret.

`CUR-PREVIEW-109` Application encryption protects configuration/rules, secret refs and backup.
Ordinary ephemeral browser cache relies on full-disk encryption and is destroyed at view teardown.

`CUR-PREVIEW-110` Plugin disable/revocation cancels in-flight resolution and Agent operations,
revokes bindings and prevents new navigation before contributions are removed.

`CUR-PREVIEW-111` A browser crash returns a typed terminal result for active tool calls, destroys
the binding and shows reload; automatic crash retry is bounded by host policy and never repeats a
click/fill.

`CUR-PREVIEW-112` Rule application failures affect rule health and diagnostics but do not block
page display. Secret, selector and page content remain redacted.

`CUR-PREVIEW-113` Node health reports configuration database, command broker and optional Terminal
dependency; Client health reports renderer/native/tunnel state without raw paths, tokens or page
data.

`CUR-PREVIEW-114` Snapshot/capture stream limits and backpressure follow
[`streams-terminals-and-large-payloads.md`](../../contracts/streams-terminals-and-large-payloads.md);
binary screenshot bytes never travel in event envelopes.

`CUR-PREVIEW-115` Capability schemas are immutable and digest-pinned. A minor version cannot add a
new CDP method, destination class, permission or secret behavior.

`CUR-PREVIEW-116` Lost-device revocation destroys that Client's next authenticated binding; until
revocation reaches an offline device, Node-side leases expire and no queued Agent command is
available for replay.

`CUR-PREVIEW-117` Full authority of a paired owner Client does not make guest content trusted; the
native boundary and no-Acorn-credential invariant remain mandatory.

`CUR-PREVIEW-118` Tests MUST prove page content cannot forge view state, approval, element refs,
target resolution, Terminal status or configuration events.

`CUR-PREVIEW-119` Preview is contract-complete only when every V1 preload/RPC/public endpoint,
browser tool, rule, Client event and view lifecycle maps to a declared V2 contract or explicit
removal here.
