# HTTP client

The API Requests plugin is a compact, Bruno-inspired HTTP client with an always-visible repo Source
and a task pane. Both presentations share the same server routes and database rows. It is separate
from acorn's [public automation API](./public-api.md): `/api/http/*` sends user-authored outbound
requests, while `/api/v1/*` lets external automation control acorn.

## Scope and storage

Saved requests belong to `(GitHub user, repo)`. A request with `task_id` is an ad-hoc draft owned by
that task; filing it in the repo tree clears `task_id`. Folders are slash-delimited strings rather
than entities, so an empty folder does not exist and rename/move cannot create orphan rows.

Sensitive request fields—URL, headers, body, auth, and per-request variables—are AES-256-GCM JWE
ciphertext under `SESSION_ENC_KEY`. Every repo-variable value is encrypted, including ordinary
values and command text. Secret-variable plaintext is never returned to the renderer. Startup
protects legacy plaintext rows before opening either listener, and renderer activation deletes
legacy `http-draft:*` localStorage. Unsaved drafts now exist only in memory.

## Request model

Methods are `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, and `OPTIONS`. Bodies support none,
JSON, text, and form encoding. Auth supports none, Basic, Bearer, and API key (header or query).
The UI has Params, Body, Headers, Auth, and Vars request tabs plus Body, Headers, and Timeline
response tabs. Pasting curl into the URL field imports supported fields; Copy as curl exports them.

The deliberate limits are part of the contract: no scripts/tests/assertions, collections, OAuth2,
Digest/NTLM, multipart body builder, recursive variable interpolation, or per-hop timing.

## Variable resolution

At send time, values merge from lowest to highest precedence:

1. task builtins: `repo`, `branch`, `worktree`, `taskId`;
2. enabled repo variables;
3. per-request variables.

Repo variables have kind `value`, `secret`, or `command`. Only names referenced by an active URL,
header, body, or auth field are resolved. A per-request override suppresses the lower repo variable
before execution, so an overridden command is never run for side effects. Referenced commands run
concurrently as `bash -lc` in the selected task worktree, falling back to the mapped repo checkout.
Each command has a 15-second/1 MiB cap and the group has a shared 30-second deadline. Command output
is never persisted.

## Sending and security

The Hono server executes requests with Node's `fetch`; no stateful main-process bridge is needed, so
the client works in `dev:node`. Sending is restricted to an interactive cookie-authenticated
principal. The internal `x-acorn-internal` principal used by agents/MCP receives
`403 interactive_user_required`, preventing the route from becoming a secret-decryption or SSRF
oracle for child processes.

Only `http:` and `https:` URLs are accepted. Requests time out after 30 seconds and response bodies
are capped at 5 MiB, with a truncation flag. Redirects use undici's standard `follow` behavior so
credentials are stripped across origins. HTTP 4xx/5xx remain successful transport results with
their headers/body; DNS, connection, TLS, and timeout failures return a typed failed attempt.
Authorization, Cookie, secret values, and command outputs are redacted from the response timeline
and error text.

This is intentionally an arbitrary outbound client for the signed-in human; it is not an SSRF-safe
fetch proxy for untrusted callers.

## Internal routes

All routes are under `/api/http/:owner/:repo`:

| Method and suffix | Purpose |
| --- | --- |
| `GET /requests?taskId=…` | List repo-filed requests or one task's ad-hoc requests |
| `POST /requests` | Create a request |
| `PUT /requests/:id` | Update/rename/move/file a request |
| `DELETE /requests/:id` | Delete a request |
| `GET /vars` | List repo variables (secret values masked) |
| `POST /vars` | Create a variable |
| `PUT /vars/:id` | Update a variable; blank unchanged secret keeps stored ciphertext |
| `DELETE /vars/:id` | Delete a variable |
| `POST /send` | Resolve variables and execute one draft |

Rows are always constrained by the authenticated login and route repo; opaque ids cannot cross
that boundary. Duplicate names return `duplicate_name`; network/setup failures return
`send_failed`; non-interactive callers return `interactive_user_required`.

Source: `apps/desktop/src/plugins/http/{client,server,shared}/`,
`apps/desktop/src/core/server/db/schema.ts`.

See also: [panes.md](./panes.md) · [data-layer.md](./data-layer.md) ·
[security.md](./security.md) · [api-reference.md](./api-reference.md)
