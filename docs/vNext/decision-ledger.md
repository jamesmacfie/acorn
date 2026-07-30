# Decision ledger

**Status:** Normative<br>
**Requirement prefix:** `DEC`

| ID | Decision | Consequence |
| --- | --- | --- |
| `DEC-001` | Electron is the V2 Client; Tauri is out of scope. | Client-native contracts target hardened Electron without coupling Node or plugin schemas to Electron. |
| `DEC-002` | The Acorn Node is Electron-free. | It can run under the bundled utility host or as a standalone service. |
| `DEC-003` | V2 supports bundled/local and directly reachable remote Nodes. | Relay operations and mobile applications are future work, but their constraints shape portable contracts. |
| `DEC-004` | One Node owns many workspaces; each workspace has one Node. | No workspace replication, distributed SQLite, or cross-Node transaction exists. |
| `DEC-005` | V2 is a single-owner fleet and every paired Client has full authority. | Pairing is a high-risk ceremony; no viewer/operator roles are implemented. |
| `DEC-006` | Electron provides a unified fleet shell. | Passive projections aggregate; every resource and mutation remains Node-qualified. |
| `DEC-007` | Nodes advertise UI coordinates/digests but never deliver executable UI into Electron. | The Client obtains and verifies bespoke UI independently. |
| `DEC-008` | Declarative views use declared bindings/actions/subscriptions only. | No ambient plugin API access or general query language is exposed to UI. |
| `DEC-009` | WASI Components are the default Community executable runtime. | Native processes are exceptional, sandboxed, and Acorn Verified. |
| `DEC-010` | Unsandboxed native code is Developer Source unrestricted code execution. | Capability UI cannot claim to confine it. |
| `DEC-011` | Core and every plugin use isolated SQLite storage. | Cross-plugin SQL and centrally interleaved plugin migrations are prohibited. |
| `DEC-012` | Transport, credentials, sensitive fields, and backups use application encryption. | General data relies on required OS full-disk encryption. |
| `DEC-013` | Event replay is bounded by seven days or 256 MiB, whichever arrives first. | Clients must implement snapshot recovery after a cursor gap. |
| `DEC-014` | Node and Client pieces install through one resumable workflow. | Internally separate artifact states appear as one owner transaction. |
| `DEC-015` | V2 is a clean start in a separate data root. | Only workspace/repository configuration can be imported; V1 is not mutated. |
| `DEC-016` | `/api/v1` is replaced, not bridged. | Existing endpoints, WebSocket frames, and tokens are invalid in V2. |
| `DEC-017` | Fresh-install Electron retains visual and behavioral parity. | Architectural separation is not permission for a product redesign. |
| `DEC-018` | GitHub, Terminal, and Agents are system plugins. | They are signed, release-locked, default-enabled, and non-uninstallable. |
| `DEC-019` | Other current features are independently packaged Verified plugins. | The default profile installs them, while dependency-safe disable/uninstall remains possible. |
| `DEC-020` | Plugins collaborate only through declared brokered contracts. | Direct imports, shared DB access, private HTTP, and ambient secrets are forbidden. |
| `DEC-021` | Commands and events are distinct. | Events are committed facts and never synchronous calls or authority evidence. |
| `DEC-022` | At-least-once per-Node event delivery is sufficient. | Consumers are idempotent; no global Fleet ordering is promised. |
| `DEC-023` | Offline arbitrary writes are not queued. | Clients retain drafts and retry only operations explicitly declared safe. |
| `DEC-024` | Monaco, xterm, diffing, and browser views are Client renderer capabilities. | Plugins request semantic renderers and remain portable. |
| `DEC-025` | Marketplace provenance and runtime isolation are independent axes. | “Verified” does not imply broad authority; “Community” is still sandboxed. |
| `DEC-026` | Relay is a fully constrained future boundary, not an enabled V2 transport. | The closed envelope, trust generations, replay window, rekey, queue and revocation rules are normative; V2 ships no relay service/toggle and later enablement requires conformance vectors. |
| `DEC-027` | The Turborepo workspace has three architectural roots: `apps/` for independently runnable products/services, `packages/` for reusable platform contracts/libraries, and `plugins/` for hosted plugin products. | Desktop and Node are separate application leaves; all first-party plugins use one logical package under `plugins/`; external repository layout remains independent of the marketplace bundle contract. |
| `DEC-028` | Contract validation and deterministic binding generation are the first executable V2 deliverable. | Product builds cannot define parallel hand-written wire types or proceed with stale generated surfaces. |
| `DEC-029` | A local/remote vertical slice precedes extraction of current features. | Identity, commands, events, snapshots, UI sessions, WASI authority and lifecycle boundaries are proven before plugins inherit them. |
| `DEC-030` | System plugins are extracted in the order Terminal, GitHub, then Agents. | Generic execution becomes core-owned first, provider identity is separated next, and Agents consumes stable execution/provider/rendering contracts. |
| `DEC-031` | Release evidence attaches to immutable artifact digests and every plugin has its own parity bundle. | A rebuild after testing, an aggregate-only parity claim or a source-review-only gate cannot authorize release. |

Changing a decision requires replacing the affected decision row, updating all traced requirements
and schemas, and recording the incompatible change in contract versioning. An implementation MUST
NOT locally override this ledger.
