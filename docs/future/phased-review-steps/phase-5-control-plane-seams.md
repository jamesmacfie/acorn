# Phase 5: the control-plane seams

Part of [phased-review-steps](./README.md). This phase is the implementation guide for the design
in [the extensibility review](../../reviews/2026-08-27-extensibility-adversarial.md) § "The
control plane, and how it stays a plugin" and its build-out phases 0 through 5. The review stays
the design record: the reasoning, the prior art (Headscale, DevPod, the Nomad two-token split),
and the trade-offs live there. This file is the sequenced work with acceptance criteria.

What this is for, in the owner's terms: acorn core stays free and open source; the business is a
hosted service that provisions nodes, runs agents and code on them, and manages them from an
acorn client. The details of the service are not settled and nothing here builds it. This phase
builds the seams any control plane, ours or a stranger's, plugs into, which is the point: the
moment a third party can write a control plane, the node-to-control-plane protocol is a public
interface, so it gets designed and versioned deliberately from the first commit.

## The model, restated once

Three parties, the third optional. The **client** coordinates across nodes it can see (the
fan-out machinery already does this). A **node** owns its data and drives its own work (phase 4).
A **control plane** holds metadata about nodes and vouches for them, and is never in the data
path. The rule that keeps it honest: the control plane stores what it takes to find a node and
vouch for it, and nothing about what the node is doing. No tasks, no repository contents, no
transcripts, no run history.

Two rules are acceptance criteria on every item below:

- **The first-party cloud plugin is a loaded plugin built only from documented seams, with no
  host privilege a third party cannot have.** If an item needs a special host change for our
  plugin, the seam is not finished.
- **Every constraint in [cloud-guardrails.md](./cloud-guardrails.md) holds.** They exist so the
  credential-custody question can move later without this contract changing.

## Work items

### 5.1 Write it down (extensibility phase 0)

Three paragraphs across three documents, no code:

- `docs/architecture-overview.md`: the three-party model and the metadata-only rule.
- `docs/security.md`: the trust inversion, beside the web-client paragraph that records its
  sibling: a control plane learns a device token for every node it provisioned, so trusting the
  control plane is the whole game. Plus the buy-backs: single-use short-lived enrollment tokens,
  a visible revocable attachment record, a detached node keeps working, audit rows.
- `docs/plugins.md`: the no-privilege rule for the first-party cloud plugin.

Done when someone can read those and correctly refuse a design that puts task data in the cloud.

### 5.2 Attachment: a node can say who it is attached to (extensibility phase 2)

The local half, testable against a stub, no control plane required:

- An optional attachment record in `node.json`: control plane URL, when, which enrollment token
  id.
- A settings surface that shows it and can detach; detaching revokes the device row and leaves
  the node fully working standalone.
- `node.enrolled` and `node.detached` in the audit vocabulary (core actions; the manifest-declared
  mechanism from phase 4 item 4.6 is for plugin verbs).

Done when a node with no attachment behaves identically, and one with a hand-written record shows
it and can drop it.

### 5.3 Unattended enrollment (extensibility phase 3)

Invert the pairing secret: today the node mints a code and a human carries it across; for a
provisioned node, the provisioner mints a token before the node exists and carries it in.

- Honor `ACORN_ENROLLMENT_TOKEN` and `ACORN_CONTROL_PLANE_URL` at first boot; with neither set,
  none of this code runs and every existing install is byte-for-byte unchanged.
- The four-step enrollment: mint the TLS certificate as today; self-issue a device token (the
  launcher handshake already does this); post `{nodeId, endpoint, fingerprint, deviceToken}` to
  the control plane authenticated by the enrollment token; record the attachment and an audit
  row. Single-use token, bounded retry, failure recorded and visible rather than a hung boot.
- A written, versioned protocol document with a JSON schema for the enrollment payload. This is
  the Headscale lesson: the protocol is public the moment it exists, so own it in `docs/` from
  the first commit.
- A stub control plane in the test suite, roughly 50 lines, that accepts an enrollment and
  acknowledges.

Done when a node booted in a container with both variables set appears in the stub's inventory,
and one booted without them is unchanged. The Docker image from [bundle.md](../bundle.md) is the
natural test vehicle and is independently first in that file's ordering.

### 5.4 The node provider contribution (extensibility phase 4)

The seam a third party needs, and the second door into the fleet:

- `ctx.providers.nodes(provider)` on the node context: host-qualified ids, disposal on unload,
  and DevPod's rule validated at registration: declaring `create` makes it a machine provider
  and `destroy` becomes required. The contract sketch (`ProvidedNode` with `providerNodeId`,
  `endpoint`, `fingerprint`, `state`, optional enrollment) is in the review.
- Providers run node-side, beside every other integration provider, so the cloud credential
  stays server-side under `SecretService`. Never client-side; the review records why that
  one-way door must stay shut.
- A core route the client reads, and a fleet list that merges helper-paired nodes with
  provider-listed nodes, provenance on each row. The merge fans out over reachable nodes and
  unions the results, deduped on `providerId` plus `providerNodeId`. Not `clientFor(localNode)`;
  that one line is what decides whether the account credential can move later.
- `FleetBridge.adopt(record, deviceToken)`, reachable only for a record a registered node
  provider produced. This is the deliberate reopening of the broker comment that says no second
  door exists; the comment changes to name the two doors and what each requires.
- A reference provider in-tree that reads nodes from a JSON file. Not a toy: it is the seam's
  only consumer until the cloud plugin exists and what the tests run against.

Done when the JSON-file provider puts a node in the picker and a task runs on it.

### 5.5 Lifecycle verbs (extensibility phase 5)

- `create`, `destroy`, `start`, `stop` surfaced in the client for providers that declare them.
- Confirmations drawn from the `ToolRisk` tiers `nodeActions` already uses; destroying a node is
  the most consequential button in the product.
- A provisioning state in the fleet row, so a node being built shows as building rather than
  offline.

Done when a person creates and destroys a node from inside acorn against the reference provider.

## Deliberately not built here

Restated from the review so this phase cannot creep:

- **No accounts in core.** A node keeps minting its own `owner-<uuid>`; the account-to-node
  mapping is the control plane's own database.
- **No node-to-node protocol.** Nodes never address each other.
- **No mirrored run state in the cloud.** "See my agents from my phone" belongs to the relay and
  push work in [remote.md](../remote.md).
- **No core `nodes` table.** The provider answers, the client merges, the helper stores what it
  adopts, `node.json` gains one optional record.
- **No allowlist of permitted control-plane URLs.** Whoever set the environment variable made
  that decision.
- **The service itself** (extensibility phase 7) and the out-of-tree proof plugin (its phase 6,
  here [phase 6](./phase-6-distribution-and-third-party.md)).

## Acceptance

- Each item's "done when" above, plus:
- A node that never sets the enrollment variables has no new behavior, verified by the boot test.
- The enrollment protocol document exists in `docs/` with a versioned JSON schema, and the stub
  control plane validates against it.
- The reference provider is a loaded plugin using only published seams. Any host change it needed
  beyond the two seams above (the provider contribution, `FleetBridge.adopt`) is written down as
  a gap, because the first-party cloud plugin will need the same and so will strangers.

## Verify before building

- Re-read the broker comment in `packages/protocol/src/broker.ts` and `FleetBridge` in
  `packages/client-core/src/platform/contract.ts`; the review counted nine members on 2026-08-27.
- Confirm phase 4 item 4.1 landed (headless trigger firing); a provisioned node that cannot drive
  its own work makes this phase pointless in the order the review argues.
- Check whether the phase 3 items the cloud plugin consumes (published types, capability
  catalogue) have landed; 5.4's reference provider should be written against them as its first
  external exercise.
- Check `docs/future/remote.md` for movement on web-client custody; if that work started, the
  credential-custody caveat in the review's "gap left open" section may already have an owner.
