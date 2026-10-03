# Node enrollment

This page covers how a Node that something else provisioned introduces itself to that control plane,
what the protocol carries, and how to undo it. Read it before you build a control plane or change the
enrollment payload.

The protocol is a public interface. Anyone can write a control plane through the node-provider seam
([node providers](./plugins.md#node-providers)), so it's versioned, its payload has a published JSON
schema, and a test pins the two together.

**Nothing here runs unless someone configured it.** With neither environment variable set, `enrollNode`
returns before it reads a file.

## The inversion

Ordinary pairing has the Node mint a short code that a person carries to a client
([pairing](./api-reference/transport.md#pairing)). The code is the secret, the person is the channel, and
comparing fingerprints by eye is what makes it safe.

A provisioned Node has no person beside it, so the secret goes the other way. The provisioner mints a
token before the Node exists and passes it in through the environment, and the Node hands the control
plane a durable credential for itself. That credential is a device token, full owner authority with no
per-token scopes. [The control plane](./security/control-plane.md) records what that costs and what
bounds it. Read it before you design anything that uses this.

## The two tokens

| Token | What it is |
| --- | --- |
| **Enrollment token** | `ACORN_ENROLLMENT_TOKEN`. Minted by the provisioner, short-lived, and single-use. It authenticates one enrollment and nothing after. |
| **Device token** | Issued by the Node to itself during enrollment, and durable. The control plane keeps it and uses it to reach the Node. |

The split means a leaked provisioning secret doesn't become a standing credential. acorn imposes no
format on the enrollment token. The Node records `enrollmentTokenId`, the first 12 hex characters of
the token's SHA-256, which isn't secret and is stable on both sides, so a support conversation can match
a Node to the provisioning record that made it.

## The four steps

At first boot, given `ACORN_ENROLLMENT_TOKEN` and `ACORN_CONTROL_PLANE_URL`, the Node
(`packages/node-core/src/server/enrollment.ts`):

1. Mints its TLS certificate as usual.
2. Issues itself a device token, on a device row of its own, separate from the launcher's, so detaching
   later revokes one thing.
3. Posts `{baseline, protocolVersion, nodeId, endpoint, fingerprint, deviceToken}` to
   `${ACORN_CONTROL_PLANE_URL}/enroll`, with the enrollment token as a bearer.
4. Records the attachment in `node.json` and writes a `node.enrolled` audit row.

It runs after the listener binds, because steps 3 and 4 need the endpoint and fingerprint, and before
the pairing banner prints, because a Node that has handed its control plane a credential shouldn't
leave an unrequested pairing window open.

**Three attempts, about fifteen seconds, then a recorded failure.** That rides out a control plane still
starting beside a Node it has created. A Node that fails all three boots normally, writes
`enrollmentError` into `node.json`, writes an audit row, and shows the failure in Settings → Nodes. The
device row from step 2 is revoked on the way out, so a credential nobody received doesn't stay valid.

**Plain `http` is refused for anything but loopback**, because a durable credential must not cross a
network in the clear. Loopback `http` stays allowed for test stubs and local control planes. There's no
allowlist of control-plane URLs: whoever set the variable made that decision.

## The payload

This is version 1. The schema is `packages/protocol/src/device/enrollment.ts`, and the published form is
[docs/schemas/enrollment-v1.json](./schemas/enrollment-v1.json), generated from it and pinned by
`packages/node-core/src/server/enrollmentSchema.test.ts`.

```json
{
  "baseline": "acorn-1",
  "protocolVersion": 1,
  "nodeId": "7f3c9c1e-5b2a-4d1e-9f77-2a5c8d0b1e44",
  "endpoint": "https://node-17.example:4317",
  "fingerprint": "3b1f…64 lowercase hex chars…c2",
  "deviceToken": "acorn_dt_<uuid>_<43 base64url chars>"
}
```

Every field is find-and-vouch metadata. `endpoint` is where a client should dial: the Node's first
advertised host, or its loopback origin when none is set. The endpoint the Node reports internally is
always loopback, because its child processes dial that, and a control plane handed
`https://127.0.0.1:4317` would vouch for an address no other machine can reach. A Node with no
`advertiseHost` enrolls with loopback anyway, which suits a control plane on the same machine
([reaching a node from another machine](./node-distribution.md#reaching-a-node-from-another-machine)).
`fingerprint` is the SHA-256 of the Node's certificate, the value a client pins, and repeating it
honestly is the whole of a control plane's vouching job.

A field describing tasks, repositories, runs, or transcripts doesn't belong here
([the three parties](./architecture/control-plane.md)).

A 2xx answer is the acknowledgement. Its body may carry `{"controlPlaneName": "…"}`, which the Node stores
and shows its owner. The answer is parsed tolerantly, for the same reason `GET /v1/node` is: a Node that
refused a successful enrollment because the answer grew a field would be one no control plane could
extend.

### Versioning

`ENROLLMENT_PROTOCOL_VERSION` is its own number, not `NODE_PROTOCOL_VERSION`, because one is
client-to-Node and the other is Node-to-control-plane. A bump means a new
`docs/schemas/enrollment-v<n>.json`, never an edit to the old one, so a control plane built against v1
keeps reading v1.

## The attachment record

The attachment is one optional object in `node.json`, and the only thing a control plane leaves on a
Node (`nodeAttachmentSchema` in `packages/protocol/src/device/node.ts`):

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

It's not a table or a second identity. Two things write `node.json`, this process's data root and the
detach route in a later process, so every write is a read-modify-write against the file.

`GET /v1/core/attachment` reads it and `DELETE /v1/core/attachment` detaches. Both are device-only,
because the read names a control plane and a device row, and the delete revokes a credential. There's
no attach route: attaching happens once, at first boot, from the environment. An HTTP attach would hand
a stranger a durable credential with one request.

## Detaching

Settings → Nodes shows the attachment on the Node's row, says the control plane holds a credential, and
offers one button. Detaching:

- revokes the control plane's device row, so its credential stops working at once;
- deletes the record from `node.json`;
- writes a `node.detached` audit row;
- changes nothing else.

A detached Node keeps working on its own. The revoke happens before the record is deleted, so a failure
leaves a visible attachment to try again, rather than a live credential nobody can see.

## Testing against a stub

`packages/node-core/src/testkit/controlPlaneStub.ts` is a small control plane. It accepts an enrollment,
spends the token once, and remembers what it was told. It checks the payload against
`enrollmentRequestSchema`, the schema this page publishes, so a Node that changes what it posts fails
there. If the stub can be written from this page, so can a real one.

Two suites use it. `packages/node-core/src/server/enrollment.test.ts` covers the unconfigured path, the
happy path, the retry, the refusals, and enroll-once. `apps/node/test/integration/lifecycle/enrollment.test.ts`
boots a real standalone Node against it and checks that the Node appears with the endpoint and
fingerprint it bound, and that a Node booted without the variables writes nothing about a control plane.

## Limits

- **No accounts in core.** A Node mints its own `owner-<uuid>` and knows nothing about a cloud identity.
  The account-to-Node mapping lives in the control plane's database.
- **No heartbeat, polling, or callbacks.** Enrollment is one request. A control plane that wants to know
  whether a Node is up asks the Node, with the credential it was given.
- **No re-enrollment.** A Node with an attachment skips enrollment however the environment is set.
  Re-attaching is a detach and a fresh token.
- **No relay.** Reaching a Node with no public address belongs to [remote access](./future/remote.md). A
  provider returns an endpoint without saying how it got it, so a relayed endpoint fits this protocol
  unchanged.
