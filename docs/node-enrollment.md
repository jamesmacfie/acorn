# Node enrollment: the node-to-control-plane protocol

A node acorn creates for you is a node nobody is sitting at. This document is how such a node
introduces itself to whatever created it, what that costs, and how to undo it.

It is also a public interface. The moment a third party can write a control plane — which is the point
of the node-provider seam in [plugins.md](./plugins.md) § Node providers — this protocol is something
strangers build against whether or not anybody versioned it. So it is versioned, its payload has a
published JSON schema, and a test pins the two together. That is the Headscale lesson, taken
deliberately rather than learned later.

**Nothing here runs unless somebody configured it.** With neither environment variable set, `enrollNode`
returns before it reads a file, and an install behaves exactly as it did before this existed.

## The inversion

Ordinary pairing has the node mint a short code and a person carry it to a client
([api-reference.md](./api-reference.md) § Pairing). The code is the secret, the person is the channel,
and comparing the node's fingerprint by eye is what makes it safe.

A provisioned node has no person beside it, so the secret goes the other way: the provisioner mints a
token *before the node exists* and passes it in through the environment. The node then hands the
control plane a durable credential for itself.

That is not registering an inventory record. It is handing a service the same credential a paired
client of yours holds, because a device token is full owner authority with no per-token scopes. What it
costs, and the four things bought back to bound the cost, is written down in
[security.md](./security.md) § The control plane. Read that before designing anything that uses this.

## The two tokens

| | |
| --- | --- |
| **enrollment token** | `ACORN_ENROLLMENT_TOKEN`. Minted by the provisioner, short-lived, and single-use. It authenticates exactly one enrollment and then buys nothing. |
| **device token** | Self-issued by the node during enrollment, and durable. This is the credential the control plane keeps and uses to reach the node afterwards. |

The split is borrowed from Nomad and the CI runner families, and its whole purpose is that a leaked
provisioning secret does not become a standing credential.

acorn imposes **no format** on the enrollment token. A control plane mints whatever it likes. What the
node records is `enrollmentTokenId`: the first twelve hex characters of the token's sha256, which is not
a secret and is stable on both sides, so a support conversation can match a node's record against the
provisioning record that produced it.

## The four steps

At first boot, given both variables, the node (`packages/node-core/src/main/enrollment.ts`):

1. mints its TLS certificate exactly as it always does,
2. issues itself a device token — a device row of its own, separate from the launcher's, so detaching
   later revokes one thing,
3. posts `{protocolVersion, nodeId, endpoint, fingerprint, deviceToken}` to
   `${ACORN_CONTROL_PLANE_URL}/enroll`, authenticated by the enrollment token as a bearer,
4. records the attachment in `node.json` and writes a `node.enrolled` audit row.

It happens after the listener has bound, because steps 3 and 4 need the endpoint and the fingerprint
that only exist once it has. It happens before the pairing banner prints, because a node that has just
handed its control plane a credential is a paired node and should not leave an unrequested pairing
window open.

**Three attempts, roughly fifteen seconds, then a recorded failure.** Enough to ride out a control plane
still coming up beside a node it just created; short enough that nobody would call it a hang. A node
that fails all three boots normally, writes `enrollmentError` into `node.json`, writes an audit row,
and shows the failure in Settings → Nodes. Retrying forever would trade a visible failure for an
invisible one. The device row issued in step 2 is revoked on the way out, so a credential nobody
received does not stay valid.

**http is refused for anything but loopback.** There is deliberately no allowlist of permitted
control-plane URLs — whoever set the variable made that decision — but a durable credential must not
cross a network in the clear. Loopback http stays allowed, because that is what a test stub and a local
development control plane are.

## The payload

Version 1. The schema is `packages/protocol/src/enrollment.ts` and the published form is
[docs/schemas/enrollment-v1.json](./schemas/enrollment-v1.json), generated from it and pinned by
`packages/node-core/src/main/enrollmentSchema.test.ts`.

```json
{
  "protocolVersion": 1,
  "nodeId": "7f3c9c1e-5b2a-4d1e-9f77-2a5c8d0b1e44",
  "endpoint": "https://node-17.example:4317",
  "fingerprint": "3b1f…64 lowercase hex chars…c2",
  "deviceToken": "acorn_dt_<uuid>_<43 base64url chars>"
}
```

Every field is find-and-vouch metadata and nothing else. `endpoint` is where a client should dial: the
node's first advertised host, or its loopback origin when nobody set one. That distinction matters,
because the endpoint the node reports internally is always loopback — every child process it spawns
dials that — and a control plane handed `https://127.0.0.1:4317` would vouch for an address no other
machine can reach. A node with no `advertiseHost` enrolls with loopback anyway, which is right for a
control plane on the same machine and useless for one that is not; either way it is the operator's
exposure decision ([node-distribution.md](./node-distribution.md) § Reaching a node from another
machine). `fingerprint` is the sha256 of the node's self-signed certificate, the value a
client pins, and repeating it back honestly is the whole of a control plane's vouching job.

A field describing tasks, repositories, runs or transcripts does not belong here and fails review by
inspection ([architecture-overview.md](./architecture-overview.md) § The three parties).

The reply is an acknowledgement. A 2xx *is* the acknowledgement; the body may carry
`{"controlPlaneName": "…"}`, which the node stores and shows its owner. The response is parsed
tolerantly, for the same reason `GET /v2/node` is the most tolerant surface in the system: a node that
refuses an otherwise-successful enrollment because the answer grew a field is a node no control plane
can ever extend.

### Versioning

`ENROLLMENT_PROTOCOL_VERSION` is its own number, not `NODE_PROTOCOL_VERSION`. The two move for
different reasons: that one is client-to-node, this one is node-to-control-plane, and a control plane
never speaks the first. A bump means a new `docs/schemas/enrollment-v<n>.json`, not an edit to the old
one, so a control plane built against v1 keeps reading v1.

## The attachment record

One optional object on `node.json`, and the only thing a control plane leaves behind on a node
(`nodeAttachmentSchema` in `packages/protocol/src/node.ts`):

```json
{
  "attachment": {
    "controlPlaneUrl": "https://control.example/",
    "controlPlaneName": "Acme Cloud",
    "attachedAt": 1756339200000,
    "enrollmentTokenId": "9f2c1a7b3d0e",
    "deviceId": "b2b0f1a4-…"
  }
}
```

Not a table, and not a second identity. Two things now write `node.json` — this process's data root and
the detach route, in a later process — so every write is a read-modify-write against the file rather
than a serialisation of a cached copy. A writer that forgot would silently drop the other's field.

`GET /v2/core/attachment` reads it and `DELETE /v2/core/attachment` detaches. Both are device-only, like
devices and plugins: the read names a control plane and a device row, and the delete revokes a
credential. There is deliberately **no attach route**. Attaching happens once, at first boot, from the
environment the provisioner set; an HTTP attach would be a way to hand a stranger a durable credential
for this node with one request, which is exactly what the single-use token exists to bound.

## Detaching

Settings → Nodes shows the attachment on the node's own row, says plainly that the control plane holds a
credential, and offers one button. Detaching:

- revokes the control plane's device row, so its credential stops working immediately,
- deletes the record from `node.json`,
- writes a `node.detached` audit row,
- changes nothing else.

That last line is the promise the whole design rests on: a detached node keeps working standalone. The
revoke happens before the record is deleted, so a failure leaves a visible attachment the owner can try
again, rather than a live credential nobody can see.

## Testing against a stub

`packages/node-core/src/testkit/controlPlaneStub.ts` is a control plane in fifty lines. It accepts an
enrollment, spends the token once, and remembers what it was told. It validates the payload against
`enrollmentRequestSchema` — the same schema this document publishes — so a node that changes what it
posts fails there rather than in a green suite. If the stub can be written from this document, so can
somebody else's real one.

Two suites use it. `packages/node-core/src/main/enrollment.test.ts` covers the unconfigured path, the
happy path, the retry, the refusals, and enroll-once. `apps/node/test/integration/enrollment.test.ts`
boots a real standalone node against it and asserts the node appears in the inventory with the endpoint
and fingerprint it actually bound — and that a node booted without the variables writes nothing about a
control plane at all.

The natural home for that second test is eventually the Docker image
[docs/future/bundle.md](./future/bundle.md) describes; the spawned standalone entry is the same node
with one fewer layer.

## What is deliberately not here

- **No accounts in core.** A node keeps minting its own `owner-<uuid>` and knows nothing about a cloud
  identity. The account-to-node mapping is the control plane's own database.
- **No heartbeat, no polling, no callbacks.** Enrollment is one request at one moment. A control plane
  that wants to know whether a node is up asks the node, with the credential it was given.
- **No re-enrollment.** A node with an attachment skips enrollment entirely, however the environment is
  set. Re-attaching is a detach followed by a fresh token.
- **No relay.** Reaching a node with no public address is [remote.md](./future/remote.md)'s problem. A
  provider returns an endpoint without saying how it was obtained, so a relayed endpoint slots in
  without changing this protocol.
