# Plugin manifest reference

Status: Normative<br>
Requirement prefix: `PLUG-MAN`

The authoritative machine shape is
[`plugin-manifest-v2.schema.json`](../contracts/schema/plugin-manifest-v2.schema.json). The validated
example is [`plugin-manifest-wasi.json`](../contracts/examples/plugin-manifest-wasi.json). This document fixes
cross-field meaning; implementations MUST satisfy both schema and semantics.

The [current-plugin fixture set](../contracts/examples/current-plugin-manifests.yaml) contains one
machine-valid primary contribution manifest for each of the twenty current packages. Package
conformance combines those fixture shapes with the complete operation, event and contribution
inventories in the current-plugin dossiers; a primary fixture is not permission to omit a
secondary contribution from a production package.

## Top-level envelope

| Field | Machine type and bound | Semantics |
| --- | --- | --- |
| `apiVersion` | literal `acorn.dev/plugin/v2` | manifest vocabulary |
| `coordinate` | `publisher/name`; each DNS-label-like segment 2–63 chars | signing/install identity |
| `version` | strict SemVer | immutable published version |
| `displayName` | string, 1–80 | owner-facing label |
| `description` | string, 1–500 | marketplace summary |
| `license` | string, 1–80, optional | SPDX expression |
| `compatibility` | closed object | protocol and renderer ranges |
| `artifacts` | 1–32 entries | content-addressed logical files |
| `contributions` | 0–256 entries | host extension declarations |
| `bespokeViews` | 0–64 entries | signed sandbox host/bridge declarations |
| `operations` | 0–512 entries | digest-pinned operation descriptor index |
| `streams` | 0–64 entries | closed stream profiles referenced by operations |
| `capabilities` | requested/exported | authority and public contracts |
| `dependencies` | 0–64 entries | exact plugin dependency edges |
| `events` | publishes/subscribes | declared event contracts |
| `settings` | 0–32 entries | typed setting schema groups |
| `wizards` | 0–32 entries | setup-wizard schema references |
| `storage` | closed object | isolated schema/quota/backup/migrations |
| `health` | closed object | runtime health thresholds |
| `provenance` | closed object | signature/SBOM/transparency evidence |

- **PLUG-MAN-001:** `provenance.manifestDigest` MUST be SHA-256 over RFC 8785 canonical JSON
  omitting `provenance.manifestDigest` and `provenance.signature`. `provenance.signature` MUST be
  Ed25519 over the ASCII domain separator `acorn-plugin-manifest-v2\0` followed by the 32 digest
  bytes. All other provenance fields remain covered. Parsing MUST reject duplicate keys,
  non-finite numbers and non-canonical Unicode before verification.
- **PLUG-MAN-002:** The publisher segment of `coordinate` MUST match the identity authorized by
  `provenance.publisherKeyId` and signature policy. Display name, homepage, source and marketplace
  location do not establish identity.
- **PLUG-MAN-003:** `coordinate + version` and `provenance.manifestDigest` resolve to one immutable
  canonical manifest. Reusing a published version for changed bytes is a supply-chain violation.
- **PLUG-MAN-004:** Unknown top-level fields fail validation. Authority-bearing extensions require
  a future manifest version and cannot be hidden inside schemas or contribution definitions.

## Compatibility

`compatibility.nodeProtocol` and `clientProtocol` are closed `{min,max}` inclusive major.minor
ranges. `rendererCapabilities[]` uses the shared capability schema and IDs such as
`acorn.code-editor/2`.

- **PLUG-MAN-005:** `min` MUST be less than or equal to `max`, and the host MUST choose one mutually
  supported protocol/capability revision before activation.
- **PLUG-MAN-006:** Headless-only plugins still declare `clientProtocol`; they set a range supported
  by their non-UI metadata. A missing required client artifact is represented by contribution/
  compatibility semantics, never an omitted protocol contract.
- **PLUG-MAN-007:** A required renderer capability MUST have a declared semantic fallback or
  explicit unsupported-client behavior. Renderer support does not confer Node authority.
- **PLUG-MAN-008:** Compatibility is evaluated over the complete selected artifact and dependency
  lock. A compatible top-level range cannot rescue an incompatible platform artifact.

## Artifacts

| Field | Rule |
| --- | --- |
| `id` | local ID, unique in manifest |
| `kind` | `runtime`, `ui`, `assets`, `schemas`, or `migrations` |
| `target` | `node`, `client`, or `shared` |
| `runtime` | `none`, `declarative`, `wasi-component`, `native-process`, `system`, or `bespoke-ui` |
| `digest` | SHA-256 content digest |
| `size` | exact uncompressed bytes, 1–2 GiB schema ceiling |
| `mediaType` | normalized media type |
| `path` | traversal-safe archive-relative path, ≤240 chars |
| `platform` | `any`, `darwin`, `linux`, or `windows` |
| `architecture` | `any`, `arm64`, or `x86_64` |
| `entrypoint` | optional traversal-safe relative entry, ≤240 chars |

- **PLUG-MAN-009:** The effective bundle ceiling is the stricter 512 MiB aggregate uncompressed
  policy even though an individual schema field can represent larger artifacts. It also enforces
  100,000 members and 100:1 aggregate compression ratio; marketplaces may lower limits.
- **PLUG-MAN-010:** Paths are normalized before extraction. Absolute paths, `..`, empty segments,
  symlinks, hard links, devices, alternate streams and case-folding collisions are rejected.
- **PLUG-MAN-011:** `wasi-component`, `native-process`, and `system` target Node;
  `bespoke-ui` targets client. Declarative and inert artifacts use the target that consumes them.
- **PLUG-MAN-012:** `runtime: none` is required for inert assets/schemas/migration data. An inert
  declaration never authorizes execution, dynamic library loading, script, font or markup behavior.
- **PLUG-MAN-013:** Every contribution references one artifact ID. The referenced artifact MUST
  have compatible target/runtime/kind and exact verified digest before contribution registration.
- **PLUG-MAN-014:** Each platform-specific artifact is a separate entry. Selection requires exact
  OS/architecture compatibility; `any` cannot describe a native executable.
- **PLUG-MAN-014A:** `bespokeViews[]` uses
  [`bespoke-view-v2.schema.json`](../contracts/schema/bespoke-view-v2.schema.json). The manifest
  MUST include the array even when empty. A bespoke view's artifact and entrypoint MUST resolve to
  the same selected `client`/`bespoke-ui` artifact; its fallback contribution MUST resolve inside
  the same manifest. Cross-field mismatch blocks coordinated activation on every client.
- **PLUG-MAN-014B:** `operations[]` is the complete discovery index for every plugin-owned query,
  command, worker entrypoint and exported capability implementation. Each entry names the exact
  operation ID and a URI/SHA-256 reference whose bytes validate as
  [`plugin-operation-v2.schema.json`](../contracts/schema/plugin-operation-v2.schema.json).
  Contribution targets that are core-owned operations resolve from the negotiated Node descriptor;
  every other contribution/worker/export target MUST resolve in this index. Duplicate IDs,
  digest mismatch or an unindexed runtime export blocks activation.
- **PLUG-MAN-014C:** `streams[]` uses
  [`stream-profile-v2.schema.json`](../contracts/schema/stream-profile-v2.schema.json). Every
  profile fixes owner, direction, media type, byte/frame/credit/replay/retention bounds,
  sensitivity, cancellation and exact required capabilities. Each operation's `streams[]` may
  reference only profiles in its own manifest. An unreferenced profile is inert; a missing,
  mismatched or capability-uncovered reference blocks activation.

## Contributions

Each contribution has unique local `id`, catalog `type`, referenced `artifact`, and a closed
discriminated `definition`. The semantic validator MUST require `type === definition.kind`.

Supported types are:

`fleet-source`, `workspace-source`, `task-pane`, `route`, `command`, `keybinding`,
`context-menu`, `shell-slot`, `task-slot`, `settings-page`, `wizard`, `notification`,
`attention-item`, `badge`, `poller`, `context-section`, `agent-tool-renderer`,
`navigation-intent`, `client-presentation`, `query`, `action`, `background-worker`, `subscription`,
`source-promotion`, `renderer-provider`, `theme`, `style`, and `notice-kind`.

- **PLUG-MAN-015:** View definitions declare renderer capability, title, deterministic order,
  optional query/action/slot and mobile fallback. Renderer IDs use `<name>/<major>`.
- **PLUG-MAN-016:** Commands/navigation intents reference one declared command, title and host
  confirmation class. A manifest confirmation is a minimum; policy may strengthen it.
- **PLUG-MAN-017:** Keybinding `when` is parsed as the bounded Acorn context-predicate language.
  It is not JavaScript and cannot authorize the command.
- **PLUG-MAN-018:** Worker contributions declare operation, nullable ISO-8601 bounded schedule and
  exact event list. An event-only subscription has `schedule: null`.
- **PLUG-MAN-019:** Query/action contributions bind namespaced operation to immutable input/output
  schemas. Inline SQL, URLs and executable mappings are invalid.
- **PLUG-MAN-020:** Theme/style `tokensPath` references a verified artifact member and is validated
  against the disjoint token vocabularies before registration.
- **PLUG-MAN-021:** Outer/inner kind mismatch, unknown renderer major, missing artifact, unsafe slot
  or route collision fails the contribution and blocks activation when required.
- **PLUG-MAN-041:** A renderer provider references only an Electron-bundled, locally allowlisted
  implementation ID. The manifest supplies no executable provider code. Only System or Acorn
  Verified provenance may declare this contribution; all other trust tiers fail activation.

## Capabilities and dependencies

`capabilities.requested[]` uses
[`capability-v2.schema.json`](../contracts/schema/capability-v2.schema.json).
`capabilities.exported[]` declares namespaced `id`, SemVer `version`, and digest-pinned input/output
schema references.

Dependencies contain `coordinate`, SemVer range `version`, boolean `optional`, and exact capability/
event IDs consumed.

- **PLUG-MAN-022:** Every requested capability MUST state scope, required status, owner-facing
  reason and closed constraints. Empty constraints mean no constrained resource, not wildcard
  access.
- **PLUG-MAN-023:** Every cross-plugin capability call and subscription MUST have a matching
  dependency entry. Wildcard coordinates, capabilities and event names are invalid.
- **PLUG-MAN-024:** Required dependency absence blocks activation. `optional: true` disables only
  contributions/contracts explicitly tied to that edge.
- **PLUG-MAN-025:** Export and event schemas are immutable references carrying URI plus SHA-256
  digest. URI locates/describes; digest establishes the schema bytes.
- **PLUG-MAN-026:** Runtime-specific deadline, side-effect, concurrency, streaming and sensitivity
  details that are not top-level manifest fields MUST be present in the referenced capability
  contract schema and validated before activation.

## Events

`events.publishes[]` and `subscribes[]` each contain namespaced `type`, compatible version/range and
digest-pinned payload schema.

- **PLUG-MAN-027:** Published event IDs MUST be owned by the plugin coordinate namespace. A plugin
  cannot publish `acorn.core.*` or another publisher's event.
- **PLUG-MAN-028:** Subscribed plugin events MUST also appear in a dependency edge's `events[]`.
  Core events require an explicit event capability grant rather than a plugin dependency.
- **PLUG-MAN-029:** Delivery/redaction/dead-letter limits come from the named event contract and
  installation policy. A manifest cannot request unbounded retention or secret plaintext payloads.

## Settings and wizards

Each setting group declares local `id`, digest-pinned `schema`, at least one allowed scope, and
`containsSecrets`. Scopes are `fleet-owner`, `node`, `workspace`, `repository`, `task`,
`installation`, and `client-device`. Each wizard declares local ID and digest-pinned setup-wizard
schema.

- **PLUG-MAN-030:** Setting schemas MUST be closed, bounded and include default, validation,
  sensitivity, precedence and restart effect semantics described in
  [settings and setup wizards](./settings-and-setup-wizards.md).
- **PLUG-MAN-031:** `containsSecrets: true` triggers secure host controls and vault-only writes.
  The schema MUST identify secret-reference fields; plaintext is never persisted in settings.
- **PLUG-MAN-032:** A wizard reference MUST validate as `acorn.dev/setup-wizard/v2`, use the same
  coordinate/ID, and declare all activation/setup gates it satisfies.

## Storage and health

`storage` contains non-negative `schemaVersion`, quota up to 10 GiB, backup policy `include`,
`exclude-cache`, or `exclude-all`, and migrations of `{from,to,digest,reversible}`.

`health` contains startup timeout 100–300,000 ms, check interval 1,000–3,600,000 ms and failure
threshold 1–20.

- **PLUG-MAN-033:** Migration edges MUST form one unambiguous contiguous route from installed
  versions to `schemaVersion`; `to > from`; each `(from,to)` digest is immutable.
- **PLUG-MAN-034:** Migration digest identifies verified migration artifact/content. Migration runs
  only against the plugin's isolated recoverable database copy.
- **PLUG-MAN-035:** `exclude-all` does not exempt secret references, owner audit or lifecycle
  metadata from their own core policies; it excludes plugin-owned content from backup.
- **PLUG-MAN-036:** Core applies the lowest manifest, marketplace, owner grant and host resource
  limit. Health self-report cannot override measured readiness/liveness.

## Provenance

`provenance` requires publisher key ID, canonical manifest digest, detached signature, SBOM digest
and HTTPS transparency entry.

- **PLUG-MAN-037:** Install verifies key authorization for coordinate/version, manifest and every
  artifact digest, transparency inclusion/freshness, revocation, SBOM binding and marketplace
  anti-rollback metadata before permission review.
- **PLUG-MAN-038:** Source references and build provenance are signed auxiliary evidence, never
  execution instructions. No package-manager, post-install, shell or arbitrary build hook exists.
- **PLUG-MAN-039:** Developer Source pins a full commit or immutable local snapshot, builds without
  credentials in an isolated builder, records resulting manifest/artifact/SBOM digests and remains
  Developer Source trust.

## Canonical example

The complete machine-valid example is maintained once at
[`contracts/examples/plugin-manifest-wasi.json`](../contracts/examples/plugin-manifest-wasi.json). Documentation
tests MUST validate it against the schema; prose examples MUST reference rather than fork it.

- **PLUG-MAN-040:** Conformance MUST test every field bound, unknown fields, outer/inner contribution
  mismatch, unsafe path/archive, signature/digest substitution, incompatible platform/protocol/
  renderer, undeclared event/dependency, invalid migration graph and permission broadening.
