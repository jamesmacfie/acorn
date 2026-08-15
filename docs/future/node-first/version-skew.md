# The client↔node compatibility contract

> **Shipped 2026-08-15, ahead of its deadline.** The contract now lives in
> `docs/api-reference.md § Versioning`, which is the doc to read and to change; this file is kept as
> the reasoning behind it, not as a plan. All five rules and every item under "the work, concretely"
> landed, with two deviations noted at the bottom.

From the node-first session (2026-08-15). Nothing here is scheduled — but this is the one file in
the folder with a deadline: **everything below must land before the first standalone node is
released** (`docs/future/bundle.md`'s pipeline). Today the client and node ship together, so any
wire change is safe. The day a node is a download, old nodes exist forever, and the freedom to
break the wire is gone. Spend it now.

## What exists today, plainly

The client checks a node's version exactly once, at pairing, and never again:

- `GET /v2/node` returns `protocolVersion` (currently `2`, `packages/protocol/src/node.ts:6`).
  The pairing probe compares it with `===` (`apps/desktop/src/app/main/nodePairing.ts:48-49`) and
  the only consequence is a disabled Continue button in the pairing dialog
  (`client-core/src/settings/NodesSettings.tsx:228-239`).
- **A node that is already paired is never re-checked.** Upgrade a node past the client's version
  and the client keeps connecting. The broker's `incompatible` connection state and the
  `protocol_mismatch` error code exist in the protocol (`packages/protocol/src/broker.ts:47,57`)
  and nothing anywhere produces either. They are dead code.
- **The handshake breaks on additions.** `nodeInfoSchema` and `pairResultSchema` are
  `z.strictObject` (`protocol/src/node.ts:31-38,60`). If a future node adds any field to
  `GET /v2/node`, today's client fails the parse and reports "did not answer like an acorn node" —
  a wrong and unactionable message. The one surface that must survive drift is the least
  drift-tolerant surface in the system.
- **Everything after the handshake is tolerant only by accident.** `readJson<T>` casts with no
  validation (`client-core/src/apiClient.ts:181-185`), so extra fields pass and missing fields
  become `undefined` that explodes later, deep in a component.
- Small rot, worth clearing while in here: the node records `protocolVersion` into `node.json` at
  first boot and nothing ever reads or updates it (`node-core/src/main/dataRoot.ts:146`); the
  authenticated handshake returns `appVersion` and nothing ever reads it; and five code comments
  cite `docs/api-reference.md § Versioning`, a section that does not exist.

The parts of the system that *are* engineered for skew were all built for the plugin boundary,
not this one — `PLUGIN_API_MAJOR` enforced on both sides, unknown permission lines rendered as
"not recognised (ignored)", trust snapshots parsed field-by-field. They are the template.

## The contract to adopt

Five rules. No new machinery beyond wiring up what already exists.

1. **One number, one meaning.** `NODE_PROTOCOL_VERSION` is the protocol major. Client and node
   each refuse a major they do not speak — nothing subtler than that.
2. **Within a major, changes are additive only.** New routes, new optional fields, new WS
   channels: fine. Renaming, removing, or changing the meaning of anything: that is the next
   major. Reads tolerate unknown and missing fields (make the accidental tolerance the stated
   rule); mutations keep their Zod validation exactly as today.
3. **The handshake is the most tolerant surface, not the least.** `nodeInfoSchema` and
   `pairResultSchema` drop `strictObject` and ignore unknown fields. The pre-auth identity
   response is frozen additive-forever, in any major — it is how a client learns it *can't* speak
   to a node, so every version of it must be readable by every client.
4. **Check on every connect, not just at pairing.** The broker probes `protocolVersion` when it
   opens a connection and produces the already-declared `incompatible` state and
   `protocol_mismatch` error when it fails. The client renders it as what it is: "this node
   speaks protocol 3; this app speaks 2; upgrade one of them." A paired node can drift; the UI
   should say so instead of failing as `undefined is not a function`.
5. **The plugin bridge inherits the same posture.** Frame-SDK verbs ship inside plugin bundles
   while the broker ships in the shell, so within a `PLUGIN_API_MAJOR` bridge verbs are additive
   only. (Already true in practice; stating it makes it reviewable.)

## The work, concretely

- Loosen the two handshake schemas; fix the probe's failure message to distinguish "not an acorn
  node" from "an acorn node speaking a different protocol".
- Move the version comparison into the broker's connect path; produce `incompatible` /
  `protocol_mismatch`; surface it on the node row and the offline banner.
- Delete the persisted `protocolVersion` in `node.json` (never read) and the unread `appVersion`
  from the authenticated handshake — or give `appVersion` its one honest use (display on the node
  settings row) and keep it.
- Add the version line to the standalone boot handshake JSON (`apps/node/src/server/standalone.ts`
  prints identity with no version field today).
- Write `docs/api-reference.md § Versioning` — the section five comments already cite — stating
  rules 1–3 in a paragraph each.
- One test: a client at major N against a stub node at major N+1 lands in `incompatible`, and a
  handshake with unknown extra fields still parses.

## Not proposed

- No response-schema validation, no OpenAPI, no codegen (already refused in
  `docs/architecture-overview.md § Wire validation`; the skew rule does not need them).
- No capability negotiation, feature flags, or minor-version handshakes. One major, additive
  within it. If that ever genuinely pinches, the escape hatch is designing negotiation *then*,
  against a real case.
- No protocol export snapshot yet. The plugin-api surface test earns its keep because plugin
  authors are outside the repo; the protocol's consumers are all inside it until standalone nodes
  ship. Revisit at that release.

## Verify before building

Whether `NODE_PROTOCOL_VERSION` is still `2` and still compared with `===` only in
`nodePairing.ts`; whether `incompatible`/`protocol_mismatch` grew a producer in the meantime;
whether the standalone handshake gained a version field; and whether `api-reference.md` gained
the Versioning section (if so, reconcile rather than rewrite).

## What shipped, and the two judgement calls

Everything in "the work, concretely" landed. Where the implementation chose between options the
brief left open:

- **`appVersion` was deleted, not given a use.** The brief offered either. Deleting won because the
  pre-auth identity response is the one surface that must stay readable by every client forever, so
  the bar for a field on it is a consumer rather than a plausible use — and adding a settings-row
  renderer would have been UI this repo cannot verify in a test. Putting it back is one line, and
  always safe, because the schema is additive-forever.
- **`nodeIdentitySchema` was loosened too**, which the brief did not ask for. Retiring
  `protocolVersion` from a `strictObject` would have made every existing `node.json` unparseable and
  every existing data root unopenable. The same reasoning that makes the wire tolerant applies to a
  file written by one version of acorn and read by all the later ones.

The broker probes on reconnect as well as on upsert, which is what makes the gate useful: a node
that upgrades restarts, which drops the socket, so the reconnect is where its new major arrives. A
probe that cannot get a clear answer opens the socket anyway — an asleep laptop must not land in a
sticky, security-shaped state.

One thing this did NOT fix, found while in here: three comments cite
`docs/api-reference.md § Pairing`, which still does not exist.
