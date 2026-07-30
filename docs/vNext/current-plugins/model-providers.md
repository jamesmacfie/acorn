# Model Providers plugin migration

Status: **Normative**<br>
Coordinate: `acorn/model-providers`<br>
Requirement prefix: `CUR-MODEL`

## 1. Current behavior and authoritative state

V1 registers OpenAI and Anthropic as generic `model-provider` connections and implements a
provider-neutral text-generation runtime. Provider accounts/model APIs are authoritative.
Acorn owns connection identity, encrypted API-key storage, selected connection/model preferences,
concurrency policy and domain results produced by consumers. V1 validates keys by listing models,
advertises curated catalogs and normalizes health/errors.

OpenAI defaults to `gpt-5.6-sol`, advertises three recommended models and submits Responses API
requests with `store: false`. Anthropic defaults to `claude-sonnet-5`, advertises Haiku/Sonnet/Opus
and concatenates text blocks. Both cap four concurrent requests per provider and two per connection.

- **CUR-MODEL-001:** Provider adapters MUST remain infrastructure capabilities. They do not own a
  consumer’s generated SQL, workflow output, agent state or other domain result.
- **CUR-MODEL-002:** Provider account identity is independent of Acorn owner/device/Node identity.

## 2. Current UI, routes, events, contributions, and dependencies

V1 contributes generic integration settings: API-key entry, connect/test/rotate/disconnect,
connection health, provider/model catalogs and model pickers embedded by consumers. It contributes
no source, Task pane, route or bespoke view. Database’s SQL generator imports the core
provider-neutral runtime and picker, not OpenAI/Anthropic SDKs.

There is no provider public plugin route or durable event stream for generation. Generic
connection routes manage lifecycle. Prompt/response data remains within the consuming operation;
provider usage may be returned to the consumer.

## 3. Target V2 classification and trust/runtime tier

- **CUR-MODEL-003:** Model Providers is an **Acorn Verified marketplace reference integration**,
  included but dormant in the default profile. OpenAI and Anthropic are separately permissioned
  WASI adapter artifacts under the coordinated package, with declarative settings/wizards.
- **CUR-MODEL-004:** A package update MAY add an adapter, but MUST NOT enable, credential or make it
  a default without owner action. A custom base-URL provider is a separate plugin and permission.

## 4. Node, Electron, native-host, and renderer split

Node core owns connection/secret brokers, HTTPS egress policy, quotas, deadlines, cancellation,
consumer delegation, event/audit policy and result-size enforcement. Provider WASI adapters own
request/response translation, catalogs, parameter support, safe error mapping and retention
declarations. Electron hosts generic settings, wizard and model picker. Consumers own their
workflow-specific UI and results.

- **CUR-MODEL-005:** No provider SDK object, access token, raw error or ambient HTTP client crosses
  the broker. Electron receives descriptors, safe health, catalog entries and consumer-owned
  results only.
- **CUR-MODEL-006:** The adapter MUST advertise supported modalities, structured output and
  parameters. Unsupported input fails validation; it is never silently ignored.

## 5. Manifest, required capabilities, permissions, dependencies, and optional integrations

Each adapter manifest declares exact HTTPS destinations, opaque credential kind, model catalog,
retention behavior, limits and `model.generate` capability. Required grants are brokered HTTPS,
one provider-scoped secret, plugin cache and health/audit emission. It requests no filesystem,
process, terminal, Git, Task mutation, arbitrary network or bespoke UI.

Consumers such as Database or Workflows declare an optional dependency on
`dev.acorn.model.generate.v1` and receive a grant scoped to their operation/purpose. Model Providers
does not depend on those consumers.

- **CUR-MODEL-007:** Capability delegation is the intersection of owner grant, calling plugin
  grant, connection policy and operation budget. An adapter cannot use its own broader connection
  authority on behalf of a caller.

## 6. Queries, commands, exported capabilities, events, and streams

| Contract | Kind | Semantics |
| --- | --- | --- |
| `dev.acorn.model.connections.list.v1` | query | Safe configured provider descriptors |
| `dev.acorn.model.catalog.get.v1` | query/capability | Curated models and supported features |
| `dev.acorn.model.generate.v1` | capability command | Bounded generation with deadline/cancel |
| `dev.acorn.model.connection.validate.v1` | command | Safe account/key validation |
| `dev.acorn.model.connection.test.v1` | command | Health without revealing secret |

Generation input contains provider connection, model ID, bounded system/prompt content,
max-output tokens, optional supported response schema/parameters, deadline and purpose. Result
contains bounded text/structured result, actual model ID, normalized finish state and usage counts.
The stable contract does not promise provider-private fields.

- **CUR-MODEL-008:** Events are `dev.acorn.model.connection.health-changed.v1`,
  `catalog.changed.v1` and redacted `usage.recorded.v1`. They exclude prompt, response, schema,
  token, raw error and provider request ID unless the latter is explicitly classified safe.
- **CUR-MODEL-009:** Generation is not replayed automatically after an uncertain transport
  outcome. Cancellation suppresses late delivery; consuming commands decide whether a fresh
  generation is safe.
- **CUR-MODEL-010:** No raw token stream is exported in V2. If incremental generation is later
  added, it uses the core stream contract, bounded frames and the same delegated authority.

## 7. UI contributions and renderer requirements

The package uses host settings and wizard renderers for provider choice, write-only key entry,
validation, model catalog, default selection, usage/privacy disclosure, health, rotate and
disconnect. Consumers use the standard connection/model picker, hiding the connection selector
when only one eligible connection exists.

- **CUR-MODEL-011:** A removed/deprecated model is shown unavailable with its previous selection;
  the client MUST NOT silently select a more expensive or differently capable substitute.
- **CUR-MODEL-012:** Missing adapter, offline Node, permission denial, quota, rate limit and provider
  outage are distinct accessible states. Mobile uses the same declarative settings/picker.

## 8. Storage, migrations, backup, uninstall, and reinstall behavior

Core owns connection IDs, application-encrypted secrets and grant records. The adapter plugin
database may own catalog cache, feature probes, safe health/backoff and redacted aggregate usage.
Prompts/responses are not provider-plugin storage; consumers persist results under their own
classification and retention.

- **CUR-MODEL-013:** Disable stops new generation but preserves consumer results. Uninstall retains
  non-secret adapter state 30 days; credential retention/deletion is an explicit core secret-store
  choice and never implicit in cache removal.
- **CUR-MODEL-014:** Reinstall may reattach retained connections only after artifact verification,
  permission approval and successful health validation.
- **CUR-MODEL-015:** V2 imports no V1 provider keys, connections, preferences, generated results or
  API tokens.

## 9. Setup, settings, health, update, and failure behavior

Setup chooses OpenAI or Anthropic, displays upstream retention/cost disclosure, captures the API
key as a write-only secret, validates it, selects a recommended default and completes a bounded
test. State is resumable without redisplaying the key. Health distinguishes bad configuration,
authentication, permission, rate limit/quota, timeout, cancellation, malformed response and
provider outage.

Updates may change safe error mapping/catalogs while preserving connection IDs. Removing capability
or changing retention/destinations blocks activation pending owner review.

- **CUR-MODEL-016:** OpenAI requests MUST preserve `store: false` unless the owner approves a
  versioned contract with different visible retention. Anthropic retention behavior MUST be stated
  honestly rather than inferred equivalent.
- **CUR-MODEL-017:** Default timeout, byte/token and concurrency limits are host-enforced and may be
  lowered per consumer; plugins cannot raise fleet security ceilings.

## 10. Security and credential treatment

- **CUR-MODEL-018:** API keys are application-encrypted, write-only opaque references injected for
  the exact provider destination and generation/validation purpose. Bespoke UI and consumers never
  receive plaintext.
- **CUR-MODEL-019:** Prompt, schema and output are sensitive transient data. They are excluded from
  events, general logs, crash reports and provider-plugin caches; privacy-safe audit records only
  caller, connection, purpose, token counts, duration and result class.
- **CUR-MODEL-020:** Inputs resist prompt-size exhaustion and schema bombs; outputs and raw errors
  are byte-bounded. Provider URLs, redirects and tool/function requests cannot escape the declared
  capability.
- **CUR-MODEL-021:** The capability is text generation, not authority. Output is untrusted and
  cannot directly execute SQL, shell, file, network or Task mutations without the consumer’s
  separately authorized validation/command.

## 11. Existing coupling that must be removed

Remove application registration of concrete OpenAI/Anthropic adapters, SDK imports from the
service graph, generic integration-row knowledge inside adapters and consumer access to adapter
implementation. Replace them with manifest discovery, core secret/HTTP brokers,
`dev.acorn.model.generate.v1`, declared catalogs and provider-specific plugin storage. Database
continues to consume only the neutral capability.

## 12. Exact fresh-install visual and behavioral parity scenarios

- **CUR-MODEL-022:** OpenAI and Anthropic connect/test/rotate/disconnect through the same settings
  experience and expose equivalent recommended catalogs/defaults and normalized errors.
- **CUR-MODEL-023:** Database SQL generation selects an eligible connection/model and receives the
  same text/usage result without importing provider code or credentials.
- **CUR-MODEL-024:** OpenAI sends `store: false`; concurrency, cancellation, timeout and malformed
  result tests behave deterministically and do not leak late output.
- **CUR-MODEL-025:** A remote client can configure and use a model connection owned by that Node;
  the key never transits to Electron and is not assumed available on another Node.
