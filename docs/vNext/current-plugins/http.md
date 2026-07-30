# HTTP plugin migration

Status: **Normative**<br>
Coordinate: `acorn/http`<br>
Requirement prefix: `CUR-HTTP`

## 1. Current behavior and authoritative state

V1 is a compact Bruno-inspired HTTP client with an always-visible API Source and Task pane. It
stores repo-filed or task-ad-hoc requests, repository variables, sends owner-authored HTTP/HTTPS
requests, supports Basic/Bearer/API-key auth, value/secret/command variables, curl import/export and
response body/headers/timeline. Acorn SQLite is authoritative for saved definitions; unsaved drafts
are memory-only.

- **CUR-HTTP-001:** V2 MUST preserve this as an explicitly owner-driven arbitrary outbound client,
  not present it as an SSRF-safe proxy for plugins, agents or untrusted declarative UI.
- **CUR-HTTP-002:** Secret values remain write-only secret references. Neither the HTTP WASI
  component nor UI receives persisted plaintext.

## 2. Current UI, routes, events, contributions and dependencies

V1 contributes Source `http`, pane `http` order 76 (`meta+shift+h`, minimum 420 px), settings for
variables, and a redacted agent-context source. Routes under `/api/http/:owner/:repo` list/create/
update/delete requests; list/create/update/delete variables; and send. Saved URLs, headers, body,
auth and request variables plus all repo-variable values are AES-GCM encrypted. Secret values return
blank. Legacy plaintext rows are protected at startup and legacy localStorage drafts are purged.

Variable precedence is Task builtins → enabled repo variables → request overrides. Only referenced
variables resolve. Command variables run concurrently as `bash -lc` in Task/checkout with 15-second,
1 MiB per command and 30-second group cap. Send uses Node fetch, 30-second timeout, 5 MiB body cap,
follows standard credential-stripping redirects, and redacts secret/command values. Internal agent
principal is forbidden. No durable product events exist.

## 3. Target classification

- **CUR-HTTP-003:** HTTP is bundled **Acorn Verified**, with WASI policy/interpolation component and
  declarative UI. Node core supplies secret broker, brokered HTTP and constrained process execution.
- **CUR-HTTP-004:** The HTTP plugin's owner-facing send capability is distinct from the
  deny-by-default `acorn.network.brokered-http/1` available to other plugins. Other plugins cannot
  invoke it to bypass destination grants.

## 4. Node, Electron, native-host and renderer split

HTTP component owns request model, interpolation, curl parser/generator, persistence contracts and
response projection. Node core owns secrets, DNS/network policy, fetch, redirect enforcement,
process execution and object transfer. Electron owns in-memory drafts/tabs/selection and standard
form/editor/table/response renderers. No Electron-native adapter is used.

- **CUR-HTTP-005:** Command-variable plaintext and secret plaintext are resolved just in time by
  brokers into one send operation, redacted from results, then discarded.
- **CUR-HTTP-006:** Stored request secret-bearing fields SHOULD become secret references or
  field-encrypted plugin rows; raw values MUST never be present in client cache or declarative view
  documents.

## 5. Manifest, capabilities, permissions and dependencies

Required: task/repository reads, plugin storage, secret create/use, owner HTTP-client send, standard
renderers. Command variables separately request `acorn.process.spawn/1` constrained to a Task
worktree and approved command-setting IDs. Agent context export requires `acorn.agent.context/1` but
exports metadata only. There are no plugin dependencies.

Manifest contributes Source, Task pane, variables settings, keybinding, request/query actions and
agent-context source. Source items are deliberately non-promotable.

## 6. Queries, commands, capabilities, events and streams

Queries under `dev.acorn.http.*.v1`: `requests.list|get`, `variables.list`, and send-operation
result. Commands: `request.create|replace|delete`, `variable.create|replace|delete`, `send`,
`send.cancel`, `curl.import`, with curl export performed client-side over the current safe draft.

Request schema preserves methods GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS; body none/json/text/form;
headers ≤100; URL ≤4,000; body ≤1 MiB; auth none/basic/bearer/apikey. Interpolation is one-pass over
individual fields, unresolved placeholders remain visible, and values cannot reshape field
boundaries.

Events are saved request/variable created|updated|deleted and send
accepted|completed|failed|cancelled. Variable events include name/kind/enabled/revision only. Send
events include operation, method, redacted origin, status/size/duration/truncated—not headers, body,
URL query, credential or command output.

- **CUR-HTTP-007:** Send is a non-idempotent external operation. Retrying uses the same command ID
  and operation record; the Node MUST NOT automatically reissue after an uncertain response.
- **CUR-HTTP-008:** Response body ≤5 MiB inline/object and marks truncation. HTTP 4xx/5xx are
  completed responses; DNS/connect/TLS/timeout are typed failures.
- **CUR-HTTP-009:** Response download MAY use object transfer. No persistent stream is required.
- **CUR-HTTP-010:** Overrides suppress lower command variables before execution so an overridden
  command cannot run for side effects.

## 7. UI contributions and renderer requirements

Preserve repository folder tree and task request list; multi-tabs/unsaved marker; method/URL/send;
Params/Body/Headers/Auth/Vars; Body/Headers/Timeline response; binary-safe response; save/file/delete;
curl paste/import and copy; variable management with set/replace masked secrets. Unsaved
credential-bearing drafts remain memory-only and are lost on client exit, with a visible warning.

Mobile fallback supports saved requests, edit/send and bounded response; curl and large binary
preview may use copy/download fallback.

## 8. Storage, migration, backup, uninstall and reinstall

Plugin DB owns `p_requests` and `p_variables`, keyed by Repository URI and optional Task URI, with
UUIDv7, folder/name/method, encrypted field envelopes or secret refs, timestamps, revision and
tombstone. Name uniqueness matches V1 scope. Definitions are sensitive and included only in
encrypted backups; send results/response bodies/command output are ephemeral.

- **CUR-HTTP-011:** V2 clean-start imports no V1 requests, variables, drafts, ciphertext or
  `SESSION_ENC_KEY`; V1 remains untouched.
- **CUR-HTTP-012:** Uninstall revokes secret refs, cancels sends, retains encrypted definitions 30
  days and cryptographically erases them on delete-now.

## 9. Setup, settings, health, update and failure

No initial wizard is required until the owner creates a secret/command variable or first sends.
That just-in-time flow explains and approves secret use, arbitrary outbound networking and command
execution separately. Settings are repository-scoped variables and Node policy limits; client tabs
are device presentation. Health checks storage, secret broker and HTTP broker; a missing Task
checkout disables only command variables.

## 10. Security and credential treatment

- **CUR-HTTP-013:** Agents, internal services, other plugins, declarative views and bespoke UI
  cannot use this owner-client send command. Authenticated owner presence and explicit action are
  required.
- **CUR-HTTP-014:** Destination validation occurs after every DNS resolution and redirect; policy
  prevents URL parser confusion, DNS rebinding and forbidden address classes according to the
  owner-client profile. Standard cross-origin redirect credential stripping is mandatory.
- **CUR-HTTP-015:** Authorization, Cookie, secret refs, resolved secret/command values and
  credential-bearing URL components are redacted from timeline, errors, logs, events and context.
- **CUR-HTTP-016:** Command variables use explicit per-variable execute grants, Task-confined cwd,
  bounded env/time/output/concurrency and no ambient Node credentials. Their output is ephemeral.
- **CUR-HTTP-017:** TLS verification is on; disabling it, arbitrary CA/key files, scripts/tests and
  pre/post-request hooks are not V2 capabilities.

## 11. Coupling that must be removed

Move `http_requests/http_variables` out of core; remove dependency on session encryption key,
principal-specific Hono middleware, task context route for repo identity, core Task environment and
client application draft purge. Replace with plugin DB, Acorn device authorization, Task/repository
capabilities, secret/HTTP/process brokers and contribution-owned activation cleanup.

## 12. Fresh-install parity scenarios

- **CUR-HTTP-018:** Owner can create/file/open/edit/send equivalent request/auth/body/headers/params
  and view equivalent status/body/headers/timeline from a local or remote Node.
- **CUR-HTTP-019:** Value/secret/command precedence and one-pass interpolation match V1; masked
  secrets never round-trip to Electron; override prevents command execution.
- **CUR-HTTP-020:** Timeouts, 5 MiB truncation, redirect credential stripping and transport-vs-HTTP
  failure behavior match or harden V1.
- **CUR-HTTP-021:** Agent context lists request shape with auth/header values/variables/body redacted;
  untrusted callers cannot turn send into a secret or SSRF oracle.
