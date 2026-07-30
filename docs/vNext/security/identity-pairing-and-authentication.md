# Identity, Pairing, and Authentication

Status: normative
Requirement prefix: `SEC-ID`

Each Acorn Node is an independent trust domain. A client is paired with each
Node separately. Pairing grants full owner authority; V2 has no limited client
roles.

## Identity material

- **SEC-ID-001:** On first boot a Node MUST generate an immutable UUIDv7
  `nodeId`, a non-exportable Ed25519 Node identity key, and a distinct
  non-exportable node-local Ed25519 certificate-authority key in the OS
  credential store where supported. A provider that cannot make them
  non-exportable MUST wrap them under the Node master key before filesystem
  storage. The displayed fingerprint is
  `acorn2:` followed by the lowercase, no-padding base32 encoding of
  `SHA-256(nodeIdentitySubjectPublicKeyInfo)`.
- **SEC-ID-002:** An Electron installation MUST generate a non-exportable
  Ed25519 device identity key. It MUST use a distinct per-Node X.509 client
  certificate and MUST NOT copy private keys during sync or backup.
- **SEC-ID-003:** The Node identity binds the node-local certificate authority
  and signs relay static-key bindings and rotation statements. The node-local
  CA signs the TLS server certificate and paired device certificates. Neither
  key signs plugin artifacts or marketplace metadata. Certificates MUST bind
  `urn:acorn:node:<nodeId>` and device certificates additionally bind
  `urn:acorn:device:<deviceId>`.
- **SEC-ID-004:** The client MUST pin `nodeId`, Node identity public key,
  node-local CA public key, normalized endpoint candidates, and display name
  together. DNS names and public CA validation alone MUST NOT change the pinned
  Node identity. Endpoint changes learned over an authenticated session remain
  routing hints under the same identity.
- **SEC-ID-005:** Device certificates MUST include the Node ID, device ID,
  serial number, `owner` authority, issue time, and expiry, and MUST be valid
  for at most 30 days. An authenticated client may renew from seven days before
  expiry. Renewal MUST preserve device identity and issue a new serial.

## Pairing ceremony

- **SEC-ID-006:** Pairing MUST be disabled by default. The owner enables one
  ten-minute pairing window locally on the Node or from an already paired
  client. Only one unconsumed window may exist.
- **SEC-ID-007:** The Node MUST display a 128-bit random, single-use pairing
  secret as 26 lowercase base32 characters in QR and grouped text plus the Node
  fingerprint as six independently derived words. The words are the first 66 bits of
  `SHA-256("acorn-v2-fingerprint-words" || 0x00 || nodeIdentitySubjectPublicKeyInfo)`, split
  most-significant-bit first into six 11-bit indices in the immutable BIP-39 English 2,048-word
  list. No Unicode translation or locale-specific wordlist is permitted; localized UI may explain
  the words but not replace them. The full `acorn2:` fingerprint remains authoritative. A short
  numeric code alone is forbidden.
- **SEC-ID-008:** Before sending a claim, the client MUST validate the full
  displayed/scanned Node fingerprint against the TLS Node identity. The claim
  MUST bind the single-use secret, Node ID, pinned Node identity, device CSR,
  endpoint, protocol major, and a fresh 256-bit nonce. The Node stores only an
  Argon2id verifier using a random 128-bit salt, 64 MiB memory, three
  iterations, and one lane, and issues a certificate only after the complete
  claim validates.
- **SEC-ID-008A:** The binding and proof algorithm is exactly `CON-PAIR-008`
  through `CON-PAIR-012`: RFC 8785 canonical transcript, CSR-key Ed25519 proof,
  pairing-secret HMAC proof, server-side reconstruction and one atomic
  certificate/device/session/audit commit. A private implementation-specific
  transcript or partially bound claim is non-conforming.
- **SEC-ID-009:** Electron MUST show the Node name, endpoint, full fingerprint
  plus its six-word human comparison, requested full-owner authority, and
  source of the pairing request. Creating the remote pairing window requires
  OS user presence locally or reauthentication on an already paired device;
  submitting the displayed secret in Electron is the second owner action.
  Bundled local pairing may use an OS-local bootstrap secret passed through an
  inherited descriptor, but MUST still pin and persist the resulting
  identities.

The Node MUST invalidate the window after success, after five failed claims, or
on expiry. Pairing attempts are limited to five per source address per 15
minutes and five total failures per window. Errors MUST NOT reveal whether the
secret, identity, CSR, or request component was wrong.

## Authenticated operation

- **SEC-ID-010:** After device credential issuance, every V2 HTTPS and WebSocket connection MUST
  use TLS 1.3 mutual authentication. The only pre-credential exceptions are
  `POST /v2/pairing/claim` and `POST /v2/recovery/claim`; they use TLS 1.3 server authentication,
  require prior verification of the exact Node-identity SPKI fingerprint and Node certificate
  binding, and authenticate the prospective device through the signed/HMAC-bound claim transcript
  in `CON-PAIR-004` or `CON-RECOVER-002`. A valid unrevoked device certificate is necessary but not
  sufficient for every other operation; authorization is checked per operation.
- **SEC-ID-011:** WebSocket upgrade MUST verify the same certificate, pinned
  Node identity, Origin, protocol version, and device status as HTTPS. Browser
  cookies, GitHub sessions, V1 bearer tokens, and the V1 internal token are not
  V2 credentials. Upgrade additionally requires a single-use 15-minute
  connection ticket obtained after mTLS, bound to the device certificate and
  TLS exporter, and carried only in `Sec-WebSocket-Protocol`.
- **SEC-ID-012:** The Node MUST maintain an authoritative device record with
  certificate serial, public key, paired/last-seen timestamps, display name,
  revocation state, and audit actor. Authentication MUST check revocation
  before dispatch and at least every 60 seconds for long-lived streams.
- **SEC-ID-013:** Revocation MUST immediately reject new connections, close
  active sockets, cancel not-yet-committed commands, invalidate outstanding
  view sessions and delegations, and emit a security audit event. Committed
  work is not rolled back.
- **SEC-ID-014:** Device removal, all-device revocation, Node identity rotation,
  and backup restore MUST require reauthentication through the local OS or a
  fresh high-friction confirmation on an already paired device. These actions
  MUST display their blast radius and require typing the Node display name.
- **SEC-ID-015:** Node identity rotation MUST issue a statement signed by both
  old and new identities when the old key is available. Clients MUST require
  explicit fingerprint confirmation when it is not. Rotation invalidates all
  device certificates and requires re-pairing.
- **SEC-ID-016:** If key material is missing or cannot be decrypted, Acorn MUST
  enter recovery mode. It MUST NOT mint replacement keys over existing
  encrypted state. Recovery either restores the original key hierarchy or
  creates a new clean trust domain after preserving the unreadable data root.
- **SEC-ID-017:** Device private-key rotation MUST implement the two-phase,
  dual-key-proof, monotonically generated transaction in `CON-ROTATE-001`
  through `CON-ROTATE-003`. Pending credentials authorize only their commit;
  the valid set switches atomically and the old serial is revoked in that
  transaction.
- **SEC-ID-018:** Sole-owner recovery MUST implement `CON-RECOVER-001` through
  `CON-RECOVER-003`. Recovery material is encrypted, Node/epoch/expiry-bound,
  rate-limited and single-use; success revokes all prior devices, advances the
  epoch and requires a fresh package. Provider identity is never recovery
  authority.

## Provider identity separation

GitHub OAuth, provider accounts, plugin API tokens, Node identity, and client
device identity are separate domains. Logging out of a provider MUST NOT
unpair a client. Revoking a client MUST NOT revoke provider credentials.
Provider credentials are handled by the Node credential broker and MUST never
be embedded in device certificates.

## Lost-device response

From another paired client or the Node's local recovery surface, the owner:

1. revokes the lost device;
2. verifies that its active connections closed;
3. reviews security audit entries since its last known possession;
4. rotates provider credentials if audit indicates secret use;
5. rotates Node identity only if the Node key, rather than a device key, may
   have been compromised.

Because a paired client has full owner authority, actions completed before
revocation remain valid. This is a documented residual risk, not a condition
Acorn can retroactively repair.
