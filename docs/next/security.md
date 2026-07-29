# Future security work

**Status:** forward-looking only. The shipped loopback, principal, credential, config-trust, tool
permission, public API, and provider-payload rules live in [security.md](../security.md) and
[authentication.md](../authentication.md).

## Current baseline that future work must preserve

- The internal server binds to `127.0.0.1`, guards Host/Origin, authenticates every `/api/*` route,
  and uses cookie/CSRF protection for the renderer.
- The persisted mode-`0600` internal token is bound to an explicit active identity, carries no
  GitHub token, and cannot use the HTTP client as a credential/SSRF oracle.
- The public automation API is a disabled-by-default second loopback listener with hashed,
  scoped, revocable bearers and separately encrypted upstream credentials.
- Repo-authored executable config/workflows are hash-reviewed through `config_acks`. A changed
  snapshot fails closed with `needs-trust`; declarative Docker match config is non-executable.
- Agent tools declare read/write/execute risk. User policy and workflow/profile ceilings only
  narrow capability.
- Rollbar occurrence normalization is allowlist- and byte-budget-based; raw occurrence JSON never
  crosses the provider boundary.

## 1. Remove the distributed OAuth client secret

Release builds currently embed a dedicated GitHub OAuth application's client id and secret through
`MAIN_VITE_GITHUB_CLIENT_*`. This is operationally convenient, but any desktop binary must be
treated as able to reveal the secret.

The preferred end state is GitHub device flow:

1. request a device/user code with the public client id;
2. show the verification URI and code in the dedicated login UI;
3. poll with the documented interval/backoff and cancellation;
4. keep the resulting access token in the existing encrypted session/upstream-credential paths;
5. remove `GITHUB_CLIENT_SECRET` from runtime bindings, CI secrets, build defines, and docs.

Do not invent a relay solely to conceal a client secret unless device flow cannot meet the required
scopes/enterprise policy. A relay would add a network trust boundary, operations, abuse controls,
and availability dependency to an intentionally local product.

## 2. Future external-control principals

If acorn later accepts relayed, webhook, or remote-control traffic, add a distinct principal kind
and capability map. Do not reuse the browser cookie, internal token, or public API bearer by
convenience. The design must specify:

- transport authenticity and replay protection;
- identity/account binding and revocation;
- read/write/execute capabilities, task/repo scope, and expiry;
- which operations require an interactive confirmation;
- audit metadata without request bodies, commands, secrets, or provider payloads;
- rate/size/concurrency limits and failure isolation.

The current public API registry and schema-first OpenAPI projection are the extension seam. A new
transport should contribute through those domain descriptors rather than mount a parallel backend.

## 3. Plugin trust model

In-tree plugins are trusted application code and are protected by compile-time/runtime boundaries,
not a sandbox. If third-party plugin loading is introduced, design signing/install consent,
declared capabilities, secrets access, filesystem/process isolation, update/revocation, and UI
provenance before executing third-party code. The current contribution registries alone are not a
security boundary.

## Verification triggers

Revisit this document when distribution expands beyond a personal/ad-hoc build, a remote listener
is proposed, or third-party plugins become executable. Until then, harden the shipped local paths
in [security.md](../security.md) and test privilege boundaries beside their routers/services.
