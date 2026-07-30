# Dependencies and collaboration

Status: Normative<br>
Requirement prefix: `PLUG-COLLAB`

Plugins collaborate through core-brokered, versioned contracts. Direct imports, shared mutable
objects, private HTTP endpoints, shared databases, inherited environment variables and filesystem
mailboxes are forbidden.

## Dependency graph

- **PLUG-COLLAB-001:** A dependency names an exact publisher/name coordinate, compatible version
  range, `required` or `optional` kind, and the capability/event contracts consumed.
- **PLUG-COLLAB-002:** The installer MUST resolve one deterministic version per coordinate per Node
  and persist the complete graph, artifact digests, selected optional edges and capability versions
  in `plugin-lock-v2`.
- **PLUG-COLLAB-003:** Required cycles are invalid. Optional cycles are allowed only when every edge
  is event-only and activation can proceed with the edge absent; synchronous capability cycles are
  invalid.
- **PLUG-COLLAB-004:** A plugin cannot depend on an implementation artifact or trust tier. It
  depends on public capability/event versions and may state a minimum trust requirement only where
  policy demands it.
- **PLUG-COLLAB-005:** Removing, disabling, quarantining or incompatibly updating a provider MUST
  recalculate dependants. Required dependants enter `blocked_dependency`; optional contributions
  deactivate while unrelated behavior stays ready.

## Synchronous exported capabilities

An export is identified by
`acorn-plugin://<publisher>/<name>/capability/<capabilityId>@<major>`.

- **PLUG-COLLAB-006:** An export MUST declare request and response schemas, compatible minor range,
  maximum request/response bytes, deadline ceiling, concurrency, idempotency class, side-effect
  class, streaming behavior, sensitivity and error set.
- **PLUG-COLLAB-007:** The broker resolves the export, validates both directions, applies rate and
  concurrency limits, enforces the caller's declared dependency and active grant, attaches a
  correlation ID, and audits sensitive or mutating calls.
- **PLUG-COLLAB-008:** Caller identity is a delegation chain containing paired device or system
  initiator, plugin installation, agent/session when applicable, Node and resource scope. Each hop
  may reduce but never widen authority.
- **PLUG-COLLAB-009:** A callee performs operations under the intersection of the original caller's
  delegated authority, the calling plugin's grant, the dependency edge, the callee's grant and
  resource policy. The callee MUST NOT substitute its own broader grant.
- **PLUG-COLLAB-010:** Capability handles are short-lived and cannot be serialized to plugin
  storage, events or UI. Reuse after deadline, caller cancellation, grant change, update or
  disablement returns `capability_revoked`.
- **PLUG-COLLAB-010A:** The broker, never plugin code, mints each 256-bit
  delegation handle and stores only its hash. The descriptor projected through
  WIT contains the initiating principal, optional agent/session, ordered
  installation-generation hops, audience, operation, resource, purpose,
  deadline and grant revisions. It is attribution, not a bearer token and
  cannot be edited or supplied as command input.
- **PLUG-COLLAB-010B:** Every nested call creates a broker-owned child record
  with attenuated authority. Mutation handles are single-use; query handles are
  audience-bound and expire in at most 60 seconds. Cancellation, grant
  revocation, generation change or root completion recursively revokes children.
  Resulting events carry only the redacted initiator/hop/grant-version
  projection defined by the event schema.
- **PLUG-COLLAB-011:** Timeouts are end-to-end. A callee's downstream work receives the remaining
  deadline, and timeout does not imply rollback unless the export declares transactional behavior.
- **PLUG-COLLAB-012:** Mutating exports MUST accept an idempotency key and resource precondition.
  The callee stores the outcome at the same commit point as its state mutation.

## Asynchronous events

- **PLUG-COLLAB-013:** A publisher owns only events in its namespace and MUST declare each event in
  its signed manifest. Runtime-created event type names are invalid.
- **PLUG-COLLAB-014:** A subscriber declares its dependency, compatible event schema range, delivery
  mode, filterable public fields, maximum handler time, sensitivity ceiling and dead-letter policy.
- **PLUG-COLLAB-015:** Core authorizes subscription separately from publication. Installing a
  dependency does not automatically grant access to sensitive event payloads.
- **PLUG-COLLAB-016:** Delivery is at least once. A subscriber commits its event ID and resulting
  plugin-state mutation atomically in its own database before acknowledgement.
- **PLUG-COLLAB-017:** Events are facts, not calls. Publishers cannot require a subscriber, depend
  on delivery order between subscribers, await subscriber effects, or treat receipt as approval.
- **PLUG-COLLAB-018:** The Node sequence orders envelopes emitted by that Node; it does not impose a
  causal total order across Nodes. Related events carry `correlationId` and `causationId`.
- **PLUG-COLLAB-019:** Schema evolution may add optional fields and enum values only where the schema
  declares unknown-value handling. Removing or changing meaning requires a new major event version.

## Resources and links

- **PLUG-COLLAB-020:** Cross-plugin references use canonical resource IDs plus a declared relation
  type. Plugins MUST not persist another plugin's database key or internal URL as an integration
  contract.
- **PLUG-COLLAB-021:** Dereferencing uses the owning plugin's authorized snapshot query. A missing,
  disabled or unauthorized owner produces an explicit unavailable linked-resource state.
- **PLUG-COLLAB-022:** A plugin may cache a redacted projection only for the declared freshness
  period and must discard it when the link, grant or provider installation is removed.

## Sagas

- **PLUG-COLLAB-023:** A workflow spanning plugins is an explicit saga owned by one coordinator.
  The manifest lists steps, idempotency keys, deadlines, persisted state, compensations and terminal
  outcomes.
- **PLUG-COLLAB-024:** Each step commits within one owner's database and emits its event after that
  commit. No transaction includes two plugin databases or a remote Node.
- **PLUG-COLLAB-025:** Compensation is a new authorized command, not storage rollback. It may fail;
  the saga then enters `manual_intervention` with completed and uncompensated effects shown to the
  owner.
- **PLUG-COLLAB-026:** Restart reconciliation resumes from persisted step outcomes and never repeats
  a non-idempotent step without retrieving its stored result.

## Version negotiation and failure

- **PLUG-COLLAB-027:** Capability negotiation selects the highest mutually compatible minor version
  within one major. The selected version is fixed for the installation generation.
- **PLUG-COLLAB-028:** Contract violation by a provider returns `invalid_plugin_response`, records
  health failure against the provider, and does not expose malformed data to the caller.
- **PLUG-COLLAB-029:** Dependency absence, authorization denial, timeout, cancellation, overload,
  incompatible version, invalid response and provider quarantine have distinct stable error codes.
- **PLUG-COLLAB-030:** Conformance tests MUST include confused-deputy attempts, undeclared calls,
  authority widening, cyclic graphs, redelivery, partial saga failure, update incompatibility,
  provider disablement and schema-invalid responses.
