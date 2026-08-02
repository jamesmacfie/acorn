# Security

## Threat model, honestly

Acorn is single-owner software. Every paired device has full authority — a deliberate product
decision, disclosed at pairing. What we defend:

- **Assets**: provider credentials (GitHub tokens, API keys), the Node's TLS key and device
  tokens, repo contents and agent transcripts, the user's machine (a Node runs arbitrary dev
  tooling by design).
- **Adversaries**: someone on the network path to a remote Node; someone who steals a backup
  file; a malicious or compromised web page inside the preview pane; hostile data from providers
  (webhook payloads, error-tracker occurrences, repo contents).
- **Out of scope**: a compromised machine (root/other-user access — that's FileVault + OS
  security's job), malicious plugins (all code is first-party), and multi-user authorization
  (there are no roles).

The V1 rule stands: agents and internal child processes are *less* trusted than the owner. They
authenticate with **internal tokens** (protocol.md) — node-issued, task/session-scoped, route-
restricted — and can never read secrets back, mint tokens, or use the Node as a secret oracle.

## Transport and authentication

- TLS 1.3 everywhere, including loopback. Self-signed Node cert, pinned per node by the client at
  pairing time. Fingerprint change = hard stop.
- Bearer device tokens (256-bit random), hashed at rest on the Node, keychain-stored on the
  client, revocable per device. Streams re-check revocation every 60s.
- Pairing: one-time 10-minute single-use code, 5 attempts, rate-limited, owner-initiated on both
  ends (see protocol.md). Failures are uniform — no oracle for "right code, wrong something".
- The bundled Node binds loopback by default. Exposing a Node beyond loopback is an explicit
  owner action, and the recommended remote path is the user's own VPN/tailnet rather than a
  public bind.

## Secrets

- Stored in the Node's core DB, encrypted with a key held in the OS keychain where one exists
  (macOS), else a 0600 `secrets.key` file in the data root (headless Linux — documented as
  relying on disk encryption + file permissions), `.env` in dev. V1's `SESSION_ENC_KEY` /
  `encryptSecret` model, kept.
- Write-only from the client: APIs accept new secret values and report presence/health
  (set / last-verified / error), never the plaintext. "Test connection" runs on the Node.
- Plugins get use-scoped access: the http client service attaches a named credential to an
  outbound request for that plugin's allowlisted hosts; the process broker injects credentials
  into a child's env per profile policy. No `getSecret()` free-for-all, and credentials never
  appear in logs, events, error bodies, or client payloads.
- Outbound HTTP for integrations is host-allowlisted per plugin (github → api.github.com, etc.).
  The user-facing HTTP client pane is exempt by design (it's the owner's own tool) but is
  owner-invoked only — agents and other plugins cannot drive it.

## On-disk

- Application encryption covers secrets and backup archives only. Worktrees, mirrors, caches,
  scrollback rely on OS full-disk encryption; the app warns once if the disk isn't encrypted.
- Data root is 0700 with an exclusive process lock.
- Backups exclude key material and secrets; restore requires re-entering credentials and
  re-pairing (data.md).

## Execution boundaries

- All child processes go through the process broker: explicit cwd inside the task worktree (or a
  declared exception), env allowlists (no ambient `ACORN_*` tokens), process-group kill,
  bounded output capture.
- Executable repo config (`.acorn/config.toml`, workflows, URL scripts) stays hash-gated behind
  the V1 config-trust acknowledgement. Imported V1 config arrives untrusted and must be
  re-acknowledged.
- Preview panes render arbitrary web content: sandboxed `WebContentsView`, ephemeral partition,
  no preload, all permission requests denied, navigation constrained — V1's hardening, kept.
  Agent browser-driving goes through a CDP method allowlist (no `Runtime.evaluate`).
- Webhook/provider payloads are validated and allowlist-normalized before persistence (rollbar's
  strict normalizer is the pattern).

## Audit

An append-only `audit` table in core: pairing/revocation, secret create/replace/delete/use,
config-trust decisions, backup/restore, non-loopback bind changes. Allowlisted fields only, no
bodies. 90-day retention. Owner-readable in Settings. No hash chains — tamper-evidence against
an attacker who already owns the DB file is out of scope (see threat model).
