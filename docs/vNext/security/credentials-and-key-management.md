# Credentials and Key Management

Status: normative
Requirement prefix: `SEC-KEY`

Provider credentials, plugin secrets, application-sensitive fields, identity
keys, and backup keys are distinct key domains. Reusing the Node TLS identity
key as an encryption key is forbidden.

## Key hierarchy

- **SEC-KEY-001:** A Node MUST generate a random 256-bit Node master key (NMK)
  independently from its identity key. The NMK MUST be non-exportable where the
  OS credential provider supports it and otherwise stored only as an
  OS-protected credential.
- **SEC-KEY-002:** Electron MUST use an independent client master key (CMK) in
  the client OS credential store. Node and client master keys MUST NOT be
  synchronized, copied into preferences, placed in environment variables, or
  included in ordinary backups.
- **SEC-KEY-003:** Domain wrapping keys MUST be derived with HKDF-SHA-256 using
  the Node/client ID as salt and an exact context containing
  `acorn-v2`, data domain, plugin installation ID where applicable, and key
  version. Contexts for credentials, sensitive fields, audit integrity, client
  cache fields, and backup wrapping MUST differ.
- **SEC-KEY-004:** Each credential and independently recoverable encrypted
  object uses a random 256-bit data-encryption key (DEK), wrapped by its domain
  wrapping key. Bulk rows may share a versioned collection DEK only when their
  retention and deletion lifecycle is identical.
- **SEC-KEY-005:** Application encryption MUST use XChaCha20-Poly1305 with a
  fresh random 192-bit nonce. Associated data MUST include Node/client ID,
  namespace, record ID, field name, schema version, and key version.
- **SEC-KEY-006:** Ciphertext storage MUST include algorithm, nonce, wrapped DEK,
  key version, creation time, and authentication tag. Unknown algorithms,
  malformed lengths, or authentication failure fail closed.
- **SEC-KEY-007:** Randomness MUST come from the operating system CSPRNG.
  Deterministic nonces, timestamps as nonces, shared counters across keys, and
  user-provided entropy are forbidden.
- **SEC-KEY-008:** Key material MUST not enter normal logs, traces, crash
  reports, analytics, IPC payload inspection, diagnostic bundles, test
  fixtures, or error envelopes.
- **SEC-KEY-009:** Private identity and master keys are accessible only to the
  native key service. Plugins, bespoke UI, the normal Electron renderer, and
  remote API clients receive operations or opaque references, never key bytes.

## Provisioning, rotation, and failure

- **SEC-KEY-010:** First boot MUST atomically create the data root, key
  hierarchy, identity, and version marker. A partially provisioned root cannot
  start network or plugin runtimes.
- **SEC-KEY-011:** If encrypted records exist but a required master key is
  absent, unavailable, or fails authentication, Acorn MUST enter recovery mode.
  It MUST NOT create a replacement key over that data.
- **SEC-KEY-012:** Routine rotation creates a new wrapping-key version, uses it
  for new writes immediately, and rewraps DEKs transactionally in bounded
  batches. Data plaintext need not be rewritten.
- **SEC-KEY-013:** Compromise rotation creates new wrapping keys and new DEKs,
  decrypts/re-encrypts every affected record, verifies it, and securely removes
  superseded wrapped material where the storage medium permits.
- **SEC-KEY-014:** Rotation progress is resumable, audited, and exposes
  `pending`, `running`, `blocked`, `verifying`, `complete`, or `failed`.
  Deletion of old keys occurs only after full verification and recovery-point
  replacement.
- **SEC-KEY-015:** Key deletion is an explicit, high-friction destructive
  operation. The UI identifies data that will become unreadable and requires
  the Node display name.
- **SEC-KEY-015A:** Portable credential backup never exports an NMK, domain
  wrapping key, identity key or plaintext secret. The key service implements
  the per-record export-DEK rewrap and fresh-Node re-encryption protocol in
  `SEC-DATA-024A` through `SEC-DATA-024F`; all other processes see only
  encrypted envelopes and opaque result references.

## Secret references

- **SEC-KEY-016:** Credentials and plugin secrets are stored only in the core
  credential broker. The public handle is an opaque, unguessable
  `secretRef`; it contains no provider, username, token prefix, storage path,
  or decryptable identifier.
- **SEC-KEY-017:** Secret metadata separates owner-visible label, provider type,
  created/updated/last-used times, allowed plugin installations, purposes,
  destination constraints, and rotation status from encrypted value material.
- **SEC-KEY-018:** Secret values are write-only. List, get, settings, event,
  backup preview, and plugin APIs MUST NOT return plaintext. Replacement accepts
  a new value and returns the same or a newly issued reference according to
  rotation policy.
- **SEC-KEY-019:** Only the trusted Acorn secret-entry renderer may receive a
  newly typed value. It sends the value directly to the authenticated Node,
  suppresses persistence/autocomplete/screenshot diagnostics, clears the field
  after acknowledgement, and never exposes it to plugin or bespoke code.
- **SEC-KEY-020:** Import from environment or file is an explicit local owner
  action. The source is read by core, validated, persisted encrypted, and then
  discarded. Plugin manifests cannot request ambient environment inheritance.

## Brokered use

- **SEC-KEY-021:** The preferred secret capability is `use`, not `raw`.
  `use` invokes a named broker operation such as HTTP authorization, SDK call,
  signing, or database connection without revealing the credential.
- **SEC-KEY-022:** A use request MUST bind calling installation, caller chain,
  secret reference, purpose, exact destination, method/operation, workspace
  scope, request ID, and current grant version.
- **SEC-KEY-023:** The broker MUST authorize before decrypting, inject the
  credential only after final destination validation, keep plaintext for the
  shortest operation lifetime, and zero owned buffers on completion where the
  runtime permits.
- **SEC-KEY-024:** HTTP use permits only `https` by default. Scheme, normalized
  host, port, path prefix, method, redirect behavior, request/response limits,
  and TLS policy are grant-bound.
- **SEC-KEY-025:** Every redirect is resolved and reauthorized. Authorization,
  cookies, client certificates, signed query data, and provider headers are
  removed on any origin change. Redirects to an IP class or scheme outside the
  grant are rejected.
- **SEC-KEY-026:** DNS resolution MUST reject loopback, private, link-local,
  multicast, metadata-service, and rebinding destinations unless the exact
  destination class is separately granted. Connection uses the validated
  address while preserving verified TLS hostname.
- **SEC-KEY-027:** Provider responses are untrusted. The broker enforces byte,
  time, decompression, redirect, content-type, and schema limits before handing
  normalized data to a plugin.
- **SEC-KEY-028:** Plugins cannot create arbitrary credential templates or
  choose where a provider credential is injected. Broker operation definitions
  are manifest-declared, schema-validated, and owner-visible.
- **SEC-KEY-029:** `raw` secret access is forbidden for every V2 plugin runtime,
  including System, Acorn Verified native, Community and Developer Source.
  When a provider cannot use the general broker, Acorn may ship a
  release-owned fixed-purpose credential helper under `SEC-AUTH-030`; it is
  part of core, cannot return bytes to the plugin and is confined for its whole
  lifetime.
- **SEC-KEY-030:** The authorization engine rejects a secret-bearing helper
  combined with direct sockets, child processes, writable unbrokered files,
  inherited handles, debugger/diagnostics, or core dumps. Its audit category is
  `credential-helper-use`; revocation terminates it and scrubs owned buffers.
- **SEC-KEY-031:** Secret-use audit records contain reference ID, provider type,
  plugin, purpose, destination class, outcome, and byte counts, never plaintext,
  authorization headers, complete URLs with sensitive query values, or
  provider bodies.
- **SEC-KEY-032:** Revoking a secret or its grant terminates new use
  immediately. Active broker requests are cancelled where safe; a request
  already accepted by a provider cannot be recalled.

## Client storage

The client CMK protects pairing metadata, sensitive cached fields explicitly
classified by their source schema, and local recovery material. Ordinary
resource snapshots, thumbnails, editor cache, and layouts rely on mandatory OS
full-disk encryption and are deleted per Node on unpair. A plugin MUST NOT mark
a credential as ordinary cacheable data.
