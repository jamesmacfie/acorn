# Discovery, pairing and handshake

Status: **Normative**
Requirement prefix: `CON-HS` / `CON-PAIR` / `CON-ROTATE` / `CON-RECOVER` / `CON-BOOT`

## Identity

A Node has an Ed25519 identity key and immutable UUIDv7 `nodeId`. It operates a node-local Ed25519
certificate authority used to issue its TLS server certificate and full-owner device certificates.
The displayed Node fingerprint is:

```text
acorn2:base32lower(sha256(node-identity-subject-public-key-info-der))
```

without padding. The hashed bytes are the complete RFC 8410 Ed25519
`SubjectPublicKeyInfo` DER value: algorithm identifier OID `1.3.101.112` with absent parameters and
the 32-byte public key in the BIT STRING. Hashing a raw 32-byte key, PEM text, JWK, certificate,
platform key reference or any other serialization is non-conforming. Certificate SANs MUST bind
the Node ID using URI
`urn:acorn:node:<nodeId>`; endpoint DNS/IP SANs are additional routing assertions. Device
certificates bind `urn:acorn:device:<deviceId>` and the issuing Node ID.

- **CON-PAIR-001** Node identity private keys and CA keys MUST be non-exportable from an OS-backed
  keystore when supported, otherwise encrypted under the Node root key.
- **CON-PAIR-002** A TLS server certificate change is acceptable only if signed by the pinned Node
  CA and bound to the pinned Node ID. Node identity fingerprint change requires explicit re-pairing.
- **CON-PAIR-003** Each client device has a distinct Ed25519 key and certificate. Sharing a device
  key between Electron installations is prohibited.

## Discovery

Discovery returns endpoint candidates, Node ID and fingerprint only. Discovery is untrusted until
the owner compares the full fingerprint. QR/deep-link payload:

```json
{
  "v": 2,
  "pairingSessionId": "01935c7a-20d2-7a34-baf4-72df9230e31",
  "nodeId": "01935c7a-20d2-7a34-baf4-72df9230e3b1",
  "fingerprint": "acorn2:…",
  "nodeIdentitySubjectPublicKeyInfo": "base64url-rfc8410-spki-der",
  "endpoints": ["https://acorn.example.test:4317"],
  "pairingCode": "base32-128-bit-one-time-secret",
  "challenge": "base64url-32-byte-random-challenge",
  "protocolMajors": [2],
  "ownerConfirmationId": "01935c7a-20d2-7a34-baf4-72df9230e3c2",
  "expiresAt": "2026-07-30T04:15:00.000Z"
}
```

The pairing code contains 128 random bits encoded as 26 lowercase base32 characters. It expires
after 10 minutes, is stored as a salted Argon2id verifier, is invalidated after one successful
claim, and allows at most five failed claims. Creating a pairing session requires an already paired
owner device with OS user presence or local Node administrative access.

### Canonical pairing transcript

- **CON-PAIR-008** The only V2 claim transcript is RFC 8785 JSON canonicalization of an object with
  exactly: `apiVersion=acorn.dev/pairing-transcript/v2`, `pairingSessionId`, `expectedNodeId`,
  `expectedNodeIdentitySubjectPublicKeyInfo`, `expectedIdentityFingerprint`, `normalizedEndpoint`,
  `selectedProtocolMajor=2`, `ownerConfirmationId`, `challenge`, `clientNonce`, `deviceId`,
  `deviceLabel`, `platform`, and `certificateRequestDigest`. `certificateRequestDigest` is
  `sha256:` plus lowercase SHA-256 hex of the exact DER CSR bytes. The endpoint uses an `https`
  absolute URI with lowercase IDNA A-label host, explicit port, `/` path, no user information,
  query, fragment, or trailing default-port elision. No other normalization is accepted.
- **CON-PAIR-009** The claim carries `transcriptDigest=sha256:<hex>` over those canonical bytes,
  `clientKeyProof` as an Ed25519 signature by the CSR private key over the 32 digest bytes, and
  `pairingSecretProof` as HMAC-SHA-256 over the same digest bytes keyed by the decoded 128-bit
  pairing secret. All binary values use unpadded base64url. The CSR subject public key MUST equal
  the proof key and the requested device ID MUST appear in its signed extension.
- **CON-PAIR-010** The Node pairing record persists every public transcript field, the Argon2id
  secret verifier, challenge digest, owner confirmation actor and one atomic status. It rebuilds
  and compares the canonical transcript, secret proof, CSR proof, fingerprint and endpoint before
  mutation. Certificate issuance, device generation `1`, owner-device creation, claim consumption
  and audit append share one database commit. The response repeats session and transcript digest.
- **CON-PAIR-011** `pending`, `claiming`, `consumed`, `expired`, `locked` and `cancelled` are the
  complete pairing-session states. A restart changes an uncommitted `claiming` session back to
  `pending` without preserving a proof; a committed session is `consumed` with certificate serial.
  Concurrent claims serialize on the session row. A consumed/expired/locked/cancelled session can
  never return to `pending`.

## Pairing claim

The unpaired Client:

1. verifies the displayed/scanned fingerprint by hashing the exact
   `nodeIdentitySubjectPublicKeyInfo` DER bytes and verifies that key signs the TLS Node-identity
   binding;
2. generates a non-exportable Ed25519 device key and CSR;
3. constructs the canonical transcript and sends `POST /v2/pairing/claim` with the CSR, transcript,
   fresh 32-byte nonce, CSR-key signature and pairing-secret HMAC;
4. verifies the returned Node descriptor and certificate chain;
5. stores the device certificate/key reference and pinned identity in the OS credential store; and
6. reconnects with mTLS and completes the handshake.

- **CON-PAIR-004** `POST /v2/pairing/claim` is the only pairing-time HTTPS exception to device mTLS.
  It uses TLS 1.3 server authentication, pins the displayed Node-identity SPKI fingerprint before
  request transmission, verifies the Node-identity-to-server-certificate binding, and authenticates
  the prospective device with `CON-PAIR-008`–`CON-PAIR-010`. No other V2 route accepts an unpaired
  device. Pairing claim MUST be rate-limited by session, source and Node. Failure responses
  are indistinguishable `pairing_failed`; they MUST NOT reveal code validity or device existence.
- **CON-PAIR-005** The issued certificate grants full owner authority and has a 30-day lifetime.
  Electron MUST renew it over an authenticated connection from seven days before expiry.
- **CON-PAIR-006** Pairing, renewal, revocation, label change and recovery export MUST emit security
  audit records. Revocation closes all current connections and rejects future certificate use.
- **CON-PAIR-007** A lost sole client is recovered only with locally protected Node administration
  or an encrypted recovery package. There is no marketplace, relay or provider-account bypass.
- **CON-PAIR-012** Pairing inputs, proofs, CSR, challenge, secret verifier and transcript bytes are
  classified security-sensitive and never enter product events, normal logs, diagnostics, URLs or
  analytics. Audit records contain only session ID, device ID, safe endpoint origin, outcome and
  transcript-digest prefix. Every claim failure uses only `pairing_failed`; expired/consumed and
  field-specific mismatch are distinguishable solely in owner-local security diagnostics.

## Device-key rotation and sole-owner recovery

- **CON-ROTATE-001** Device-key rotation is two-phase. Prepare is mTLS-authenticated by the current
  credential and carries the next CSR plus old- and new-key Ed25519 proofs over RFC 8785 canonical
  `{nodeId,deviceId,currentGeneration,nextGeneration,rotationId,csrDigest,clientNonce,expiresAt}`.
  `nextGeneration` MUST equal current plus one. The Node stores a one-hour pending credential that
  authenticates only the matching commit route; ordinary dispatch still accepts only the old key.
- **CON-ROTATE-002** Electron durably stores the pending certificate and new OS key reference
  before commit. Commit contains Node-issued challenge and signatures by both keys. One transaction
  activates the next generation, revokes the old serial, consumes the rotation journal, closes old
  connections and appends audit. A lost response is recovered by authenticating with the new key;
  before commit, abandoning/expiry deletes pending material and leaves the old key active.
- **CON-ROTATE-003** Concurrent rotation, generation mismatch, changed CSR, replayed challenge or
  proof, expired journal and a new key used outside its commit route fail closed. Restart reads the
  persisted `prepared` or `committed` state; no transient state allows two ordinary credentials.
- **CON-RECOVER-001** A recovery export is an XChaCha20-Poly1305 envelope containing only recovery
  ID, Node ID/fingerprint, recovery epoch, 256-bit random recovery secret, creation/expiry and
  manifest digest. It never contains Node/CA/device private keys. It is encrypted under an
  owner-chosen recovery key using the backup Argon2id profile, expires within 90 days and is created
  only with local OS presence or an active owner device plus OS reauthentication. The Node stores
  only an Argon2id verifier and epoch.
- **CON-RECOVER-002** `POST /v2/recovery/claim` is the only recovery-time HTTPS exception to device
  mTLS. It uses the same TLS 1.3 server-authentication, Node-identity SPKI pinning and certificate
  binding checks as `CON-PAIR-004`. Recovery claim binds recovery fields,
  new device identity/CSR digest, fresh nonce and expiry in an RFC 8785 transcript. The new device
  key signs the digest and the recovery secret HMACs it. Success atomically revokes every prior
  device credential, creates replacement generation `1`, increments recovery epoch, consumes every
  authority from the old epoch, closes sessions and appends audit.
- **CON-RECOVER-003** Node-local administration uses an OS-protected root/service-manager channel,
  verifies local administrative identity and physical user presence, then creates a fresh
  five-minute recovery session with the same transcript and commit rules; it does not bypass CSR
  proof or Node fingerprint display. Recovery failures are uniform, limited to five per recovery ID
  and source per 15 minutes, and subject to exponential delay. Use, expiry, Node identity rotation
  or explicit revocation invalidates the package. A successful recovery immediately offers a new
  package and destroys the consumed secret.

## Bundled-local bootstrap

Bundled bootstrap is a distinct enrollment transport for the first local owner. It issues the same
device certificate and creates no permanent alternate authentication mechanism.

- **CON-BOOT-001** Packaged macOS/Linux clients use an anonymous
  `AF_UNIX/SOCK_SEQPACKET` socketpair; Windows uses an anonymous named-pipe pair with an explicit
  inheritable handle list. Electron marks every other descriptor non-inheritable and passes exactly
  one endpoint to the directly spawned Node. Filesystem sockets, loopback ports, command-line
  secrets, environment variables, temporary files and discoverable pipe names are forbidden.
- **CON-BOOT-002** Before spawn, Electron verifies the Node artifact's platform code signature,
  Acorn release publisher and SHA-256 digest from the signed release manifest. After spawn, both
  peers validate OS peer credentials/parent-child PID relation where the platform exposes them;
  the child reports its executable digest and release-manifest digest through the inherited
  channel. A mismatch terminates the child before Node data-root initialization.
- **CON-BOOT-003** Electron creates an OS-keystore-protected journal containing `bootstrapId`,
  random 256-bit one-use secret, expected artifact/manifest digests, device key reference/CSR
  digest and client nonce. The Node records only an Argon2id verifier and state. The RFC 8785
  transcript contains exactly `apiVersion=acorn.dev/local-bootstrap/v2`, bootstrap ID, Node ID and
  identity public key, both release/artifact digests, parent and child process identities,
  selected protocol major, device ID/CSR digest, both 256-bit nonces and channel kind. The device
  key and Node identity key each sign its SHA-256 digest; both peers also verify HMAC-SHA-256 under
  the bootstrap secret.
- **CON-BOOT-004** States are `prepared`, `node_committed`, `client_committed`, `acknowledged`,
  `cancelled` and `expired`. The Node atomically commits identity initialization where needed,
  exactly one owner device at credential generation `1`, certificate serial, bootstrap transcript
  digest and audit record before returning the certificate. Electron durably stores the
  certificate and pin, changes its journal to `client_committed`, then acknowledges. The Node marks
  `acknowledged` and both sides erase one-use material.
- **CON-BOOT-005** A retry with the same bootstrap ID, device ID, CSR digest and transcript returns
  the same certificate until acknowledgement; any differing field fails and requires local
  deletion of the unpaired new V2 root through trusted recovery UI. Parallel bootstrap IDs
  serialize so only one can reach `node_committed`. Parent death while pending terminates the
  supervised Node; child death causes exact-journal retry. Crash before Node commit returns to
  `prepared`; after Node commit the idempotent recovery completes the same credential. Expiry is
  five minutes except an already `node_committed` recovery journal, which remains recoverable for
  24 hours and cannot authorize a different device.
- **CON-BOOT-006** Development mode uses the same socket/pipe and state machine but accepts only an
  operator-confirmed absolute Node binary plus a locally recorded SHA-256 digest. The trusted UI
  labels it Developer Node; it cannot bind non-loopback during first bootstrap. If code-signature,
  peer-credential or inherited-channel enforcement is unavailable, packaged bootstrap fails closed
  and instructs the owner to repair/reinstall; it never falls back to ordinary pairing or loopback
  trust.

## Session handshake

After mTLS, Electron sends `POST /v2/session/handshake`. The Node validates certificate status and
selects one protocol version. The response includes a `sessionId`, monotonically increasing
`sessionRevision`, descriptor, selected encodings, event range and a 15-minute connection ticket
bound to the device certificate and TLS exporter. The ticket authenticates the single WebSocket
upgrade and is invalid after use.

- **CON-HS-001** Handshake tickets MUST NOT be accepted as HTTP bearer credentials, placed in a URL
  or persisted. WebSocket presents it in `Sec-WebSocket-Protocol` as `acorn.v2.ticket.<base64url>`.
- **CON-HS-002** Node MUST reject replayed, expired, wrong-device or wrong-TLS tickets with a generic
  upgrade failure.
- **CON-HS-003** Client clock is advisory. Deadlines are evaluated using Node time; handshake
  reports `nodeTime` and `maxClockSkewMs=300000`.
- **CON-HS-004** Updating renderer capabilities increments `sessionRevision`. Commands with an old
  revision fail `session_stale`.

## Reconnect

Every transport reconnect performs a new mTLS handshake and obtains a new one-use WebSocket ticket.
Endpoint candidates may change; Node ID and trust fingerprint may not. The client resumes from its
last durably applied event sequence or follows the snapshot resynchronization flow.
