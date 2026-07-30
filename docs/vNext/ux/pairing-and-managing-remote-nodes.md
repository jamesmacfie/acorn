# Pairing and managing remote Nodes

Status: Normative<br>
Requirement prefix: `UX-PAIR`

V2 connects directly reachable remote Nodes. Relay and mobile clients are constrained elsewhere but
are not V2 deliverables. Every paired client is a full Fleet owner, so pairing and recovery are
high-friction security operations.

## Add Node

The Node management surface offers:

- Local Node, already bootstrapped;
- Add by verified HTTPS address;
- Add from a one-use pairing QR/text payload transferred out of band;
- future relay option shown only when a compatible release implements it.

- **UX-PAIR-001:** Pairing payload contains Node ID, display label, endpoint(s), Node public-key
  fingerprint, one-use challenge, expiry and protocol range; it contains no long-lived credential.
- **UX-PAIR-002:** Electron displays normalized endpoint, Node fingerprint in words/hex, expiry and
  the warning that pairing grants full owner authority. Owner MUST confirm fingerprint through an
  independent channel before the Node issues credentials.
- **UX-PAIR-003:** Pairing requires local Electron owner/device authentication where the OS supports
  it and explicit confirmation. A URL/deep link/QR cannot auto-submit confirmation.
- **UX-PAIR-004:** Node verifies one-use challenge, client device key proof, protocol, clock/expiry
  and owner confirmation; then issues device-bound credentials over TLS 1.3. Challenge replay or
  endpoint identity change fails closed.
- **UX-PAIR-005:** Electron independently verifies Node certificate/identity pin at every connection.
  Public CA validity alone is insufficient after pairing.

## Paired Node representation

Each Node row/detail shows:

- owner-chosen label and immutable short Node ID/fingerprint;
- endpoint and direct/local connection method;
- online/degraded/offline/identity-changed/revoked/incompatible state;
- Node/server version and negotiated protocol;
- last connected, clock skew and certificate/key health;
- workspaces/tasks/active agents summary;
- installed plugin/attention/health summary;
- paired devices and last use;
- actions Rename, Reconnect, Rotate, Export Fingerprint, Revoke Device, Unpair Client.

- **UX-PAIR-006:** Labels are non-authoritative and may collide. All destructive/device/plugin
  actions show label plus immutable Node fingerprint fragment.
- **UX-PAIR-007:** One Node owns many workspaces and one workspace belongs to exactly one Node.
  Moving a workspace between Nodes is export/import, never reassignment of a database row.
- **UX-PAIR-008:** Identity change displays a security stop with old/new fingerprints. Reconnect,
  certificate override or automatic trust-on-first-use is prohibited; owner must recover the known
  Node or explicitly remove and pair a new identity.

## Device and key management

- **UX-PAIR-009:** The paired-device list shows device name, key fingerprint, platform, created,
  last seen and status. Rename changes display only; Revoke takes effect immediately and is audited.
- **UX-PAIR-010:** Device credential rotation is a mutually authenticated transaction that creates
  a new key, verifies it, switches, then retires old key. Interrupted rotation retains exactly one
  recoverable valid path and shows state. The two-phase wire transaction and crash behavior are
  `CON-ROTATE-001` through `CON-ROTATE-003`; the UI never deletes the old key before durable commit.
- **UX-PAIR-011:** Lost-device recovery begins from another paired full-owner client or a Node-local
  recovery interface. It revokes lost key before or atomically with replacement and never uses
  provider/GitHub identity as proof. Sole-owner package/local recovery follows
  `CON-RECOVER-001` through `CON-RECOVER-003`, displays Node fingerprint/epoch/affected devices,
  requires OS presence and rotates the recovery authority after use.
- **UX-PAIR-012:** Because every paired device is full owner, Acorn MUST NOT present device pairing
  as a read-only viewer. A future limited role requires a new authorization model/version.

## Unpair and remove

- **UX-PAIR-013:** “Remove from this Electron client” deletes this client's Node credentials/cache/
  presentation state but does not mutate Node workspaces/plugins/data or revoke other devices.
- **UX-PAIR-014:** “Revoke this device on Node” is a Node mutation and requires owner confirmation.
  If this is the current last device, Node requires local recovery proof or explicit lockout
  acknowledgment according to Node policy.
- **UX-PAIR-015:** Offline remove can delete local credentials immediately; remote revocation remains
  pending and is prominently shown until another authorized path confirms it.

## Failure and acceptance

- **UX-PAIR-016:** Pairing errors distinguish unreachable, TLS failure, fingerprint mismatch,
  challenge used/expired, clock skew, incompatible protocol, owner denied and rate limited without
  exposing server secrets.
- **UX-PAIR-017:** Tests MUST cover MITM, swapped QR/endpoint, challenge replay, wrong fingerprint,
  expired challenge, two concurrent pairings, key rotation crash, lost current/last device, Node
  identity replacement, offline unpair and colliding labels.
