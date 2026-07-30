# Specification completeness matrix

**Status:** Closed; approved by final closure report<br>
**Review date:** 2026-07-31<br>
**Requirement prefix:** `REVIEW-COMP`

This matrix is the evidence index for the Acorn V2 specification programme. A “pass” records
available objective evidence; it does not override an open Critical, High or unaccepted Medium
review finding.

## 1. Corpus shape

| Gate | Evidence | Result |
| --- | --- | --- |
| self-contained `docs/vNext` corpus | 207 files: 156 Markdown, 46 JSON, four YAML and one WIT artifact | pass |
| requested directory layout | every requested architecture/contracts/data/plugins/UI/UX/security/current-plugin/examples/migration/development/reviews area exists | pass |
| six complex plugin folders | Agents, Editor, GitHub, Preview, Terminal and Workflows each have the required five files | pass |
| twenty current packages | 20 coordinates in current-plugin index and 20 validated fixture manifests | pass |
| normative language | conventions define RFC 2119 interpretation, identifiers, schemas and sensitivity | pass |
| unfinished markers | case-sensitive unfinished-authoring token scan returns zero | pass |
| application/source isolation | `git status --short docs/vNext` shows only the new vNext tree; application code and pre-existing docs are untouched by this programme | pass |

## 2. Locked product and architecture decisions

| Decision | Normative evidence | Machine/test evidence | Result |
| --- | --- | --- | --- |
| Electron V2 Client; Tauri out | product contract, decision ledger, Electron Client architecture | desktop parity acceptance | pass |
| Electron-free local/remote Node | system overview, Node/runtime boundaries, topology | Node descriptor and handshake | pass |
| relay/mobile constrained, not V2 | topology, relay security contract, decision `DEC-026` | relay envelope schema; no V2 enablement path | pass |
| one Node owns many Workspaces; Workspace has one Node | Fleet/resource ownership and canonical entities | canonical `acorn://` identities and snapshot schema | pass |
| full-owner paired Client model | product contract, identity and pairing | pairing/rotation/recovery OpenAPI contracts | pass |
| unified multi-Node Fleet shell | Electron Client, unified Fleet UX | fleet cache partition and snapshot contracts | pass |
| one-Node mutations/no cross-Node transaction | command/data consistency contracts | wrong-Node and saga acceptance tests | pass |
| Client independently verifies UI artifacts | runtime boundaries, bespoke/declarative UI security | manifest/lock/provenance schemas | pass |
| declarative UI only declared data/actions/events | UI model and view sessions | UI document/patch/view-session schemas | pass |
| Community executable default is WASI | plugin/runtime/trust documents | WIT and manifest runtime enum | pass |
| native requires enforceable OS sandbox | native runtime and plugin trust | native conformance cases | pass |
| core and plugin SQLite isolation | data ownership/plugin storage | node core table catalog and tenant rules | pass |
| application encryption boundary | data protection, credentials, transport | backup/relay/audit envelope schemas and tests | pass |
| event retention 7 days/256 MiB | event/outbox contracts | descriptor/snapshot/event schemas and replay tests | pass |
| coordinated Node/Client install | install/lifecycle/UX contracts | exhaustive transition catalog and lock schema | pass |
| clean-start V2 | migration/import documents | V1 surface ledger and import acceptance | pass |
| `/api/v1` replaced | API removal contract | 190-operation ledger and V1 404 acceptance | pass |
| fresh desktop parity | baseline and desktop parity contract | per-plugin parity scenarios | pass |
| System/Verified classifications | system plugins and current-plugin index | 20 manifest fixtures and install profile | pass |
| Turborepo source topology | `apps/` applications, `packages/` platform libraries/contracts, and first-class `plugins/` workspace root | repository structure, dependency graph and external-repository conformance | pass |
| contract-first implementation sequence | deterministic contract generation, distributed vertical slice, early security harness, dependency-ordered extraction and artifact-bound release | build sequencing gates `G0A`–`G5`, Turbo tasks and per-plugin evidence bundles | pass |

## 3. Architecture, transport and data coverage

| Required area | Evidence | Result |
| --- | --- | --- |
| vocabulary | glossary plus product/architecture definitions | pass |
| node-qualified identity | resource identity grammar, ownership model | pass |
| HTTPS plus one authenticated WebSocket/Node | OpenAPI/AsyncAPI and stream contract | pass |
| TLS 1.3/mTLS/fingerprint pairing | pairing and transport security | pass |
| provider identity independence | identity contract and GitHub dossier | pass |
| discovery/pair/reconnect/revoke/rotate/negotiate/skew/backpressure/timeout/cancel | discovery/handshake, errors, streams, offline/failure docs | pass |
| future opaque relay | topology/security/relay schema | pass |
| core/plugin/client storage ownership | all eight data documents | pass |
| V1 untouched/config-only importer | clean-start/import and V1 table ledger | pass |
| V1 API/token incompatibility | API removal and wire conformance | pass |
| backup/restore/deletion | backup, plugin uninstall/reinstall, security recovery | pass |

## 4. Commands, events and collaboration

| Gate | Evidence | Result |
| --- | --- | --- |
| command vs fact distinction | query/command and event documents | pass |
| mutation security/reliability fields | plugin-operation schema and current-plugin semantic profiles | pass |
| durable outbox/sequence/at-least-once/replay | event/outbox documents and event schema | pass |
| custom event namespace/declaration | plugin event contracts/manifest | pass |
| dependency-gated subscriptions | dependency/collaboration contract | pass |
| synchronous capability broker | capability schema, WIT host, collaboration contract | pass |
| delegated authority preservation | opaque delegation handle/descriptor and audit attribution | pass |
| prohibited coupling | dependency rules and 25-edge extraction map | pass |
| multi-plugin sagas/no distributed transaction | consistency/saga and collaboration example | pass |

## 5. Plugin package, lifecycle and trust

| Gate | Evidence | Result |
| --- | --- | --- |
| logical artifact split | plugin model and manifest schema | pass |
| four runtime tiers/four trust tiers | plugin model, runtimes, trust model | pass |
| trusted/community/Developer Source acquisition | marketplace/supply chain and installation | pass |
| Community/native constraints | runtime/trust security | pass |
| no install scripts/isolated source builds | installation plus source-build-plan schema/example | pass |
| immutable signing/SBOM/provenance/revocation/anti-rollback | manifest/lock/marketplace security | pass |
| lifecycle transition completeness | `PLUG-TRANS-010`–`058`, coordinated Client acquisition | pass |
| partial installation visibility | install/UX/lifecycle rules | pass |
| contribution kinds | 28 closed types and 28 validated positive fixtures | pass |
| supervised workers | scheduled/event/resident schema, WIT and fixtures | pass |
| current plugin manifests | 20 YAML manifests validated against manifest schema | pass |

## 6. UI, settings and wizard coverage

| Gate | Evidence | Result |
| --- | --- | --- |
| every contribution surface | contribution catalog and schema | pass |
| renderer catalog | six renderer documents plus capability/leaf registry distinction | pass |
| host implementation abstraction | named code/diff/terminal/browser capabilities | pass |
| declarative restrictions | UI/security contracts prohibit HTML/JS/CSS/ambient endpoints | pass |
| bounded view sessions | document/patch/session schemas and limits | pass |
| focus/selection/optimism/reconnect/a11y/l10n/responsive/fallback | view/UI/renderer/accessibility documents | pass |
| bespoke package/origin/CSP/bridge/access denial | five bespoke documents and security tests | pass |
| fallback/mobile behavior | every contribution/family rules and Herdr archetypes | pass |
| settings scopes/precedence | settings/wizard plugin and UX docs | pass |
| write-only secrets/broker use | credentials and authorization contracts | pass |
| all wizard step kinds/resumption | setup-wizard schema, settings/setup UX | pass |

## 7. Current behavior and migration closure

| Gate | Evidence | Result |
| --- | --- | --- |
| 20 plugin dossiers | current-plugin index and parity review inventory | pass |
| fixed classifications/ownership corrections | current-plugin docs and system plugin contract | pass |
| per-operation semantics | operation catalog plus plugin-specific contracts | pass |
| 25 cross-feature imports | extraction map: 12 core→plugin + 13 plugin→plugin | pass |
| V1 routes | interactive route registry ledger | pass |
| V1 public API | exact 190-operation ledger | pass |
| V1 events/channels | Client/will/internal WS/public event ledger | pass |
| V1 data | exact 47-table ownership/import ledger | pass |
| V1 Client contributions | pane/source/context/poller/slot/settings/notice/persistence ledger | pass |
| Terminal shortcut | `Cmd+Shift+T` in desktop and Terminal parity | pass |

## 8. Herdr closure

| Gate | Evidence | Result |
| --- | --- | --- |
| exact source snapshot | 100 rows with repository, commit, version, manifest and access method | pass |
| 25-question assessment | stable rubric applied to every row | pass |
| total mapping | 100 unique row numbers, no gap/duplicate, mapped to 35 archetypes | pass |
| observed surface coverage | actions, panes, events, links, startup, builds and workers | pass |
| Acorn contract coverage | contribution/operation/worker/build/runtime/security expansion | pass |
| deliberate gaps | 89 Supported, seven Extension, four Unsupported with named decisions | pass |
| community examples | declarative/WASI/native/worker/terminal/monitoring/integration/collaboration examples | pass |

## 9. Security closure

| Gate | Evidence | Result |
| --- | --- | --- |
| malicious actor coverage | threat model covers Node, Client, plugin, UI, repo, provider, marketplace, relay, archive, update and lost device | pass |
| pairing/device/recovery | cryptographic transcript/proofs, rotation and recovery contracts | pass |
| capability/delegation/confused deputy | closed grant constraints, original-caller delegation | pass |
| credential/key/backup theft | key hierarchy, broker, rewrap/restore and failure-closed behavior | pass |
| WASI/native/bespoke isolation | runtime and UI isolation contracts | pass |
| supply chain/source/archive | signature/provenance/transparency/SBOM/build/archive controls | pass |
| event/replay/downgrade | durable cursor, relay replay window and anti-rollback | pass |
| audit/incident | signed audit envelope/checkpoints/export and response workflow | pass |
| explicit code execution disclosure | Terminal and unsandboxed Developer Source risks stated | pass |
| conformance catalog | pairing, CSP, WASI, native, traversal, SSRF, deputy, supply chain, replay, secret and backup cases | pass |

## 10. Machine-validation evidence

| Check | Current evidence | Result |
| --- | --- | --- |
| JSON parsing | all JSON documentation artifacts parse | pass |
| YAML parsing | OpenAPI, AsyncAPI and YAML fixture sets parse with aliases enabled | pass |
| JSON Schema compilation | all Draft 2020-12 schemas compile under strict Ajv | pass |
| JSON examples | manifest, UI, event, wizard, capability, operation and source-build examples validate | pass |
| YAML fixture examples | 20 current manifests and 28 contribution kinds validate | pass |
| Herdr arithmetic | expansion ledger contains 001–100 exactly once | pass |
| local Markdown links | zero broken local links | pass |
| WIT syntax/semantic review | protocol review plus mandatory pinned parser/bindgen CI replay | pass |
| OpenAPI/AsyncAPI semantic agreement | protocol review and complete `$ref` resolution | pass |
| whitespace | `git diff --check -- docs/vNext` | pass |
| sequencing closure | all implementation waves name prerequisites, gate evidence, ownership and invalidation behavior | pass |

## 11. Review status

| Review | Report | Closure |
| --- | --- | --- |
| protocol and schema | [protocol-and-schema-review.md](./protocol-and-schema-review.md) | closed |
| security red team | [security-red-team-review.md](./security-red-team-review.md) | verified closed |
| plugin/parity/Herdr | [plugin-parity-and-herdr-review.md](./plugin-parity-and-herdr-review.md) and [Herdr escape review](./herdr-escape-review.md) | verified closed |
| final cross-review | [final-closure-report.md](./final-closure-report.md) | approved |

`REVIEW-COMP-001` Completion is prohibited while a row above is pending or any reviewer retains a
Critical/High finding. Medium findings require a resolved change or accepted-risk decision with
owner, rationale and verifier. No row is pending and no Critical, High or Medium specification
finding remains open at the recorded closure revision.
