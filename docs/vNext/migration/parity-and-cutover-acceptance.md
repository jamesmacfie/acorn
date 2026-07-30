# Parity and cutover acceptance

**Status:** Normative release gate<br>
**Requirement prefix:** `ACCEPT-MIG`

## Fresh-install parity

The acceptance environment contains a fresh V2 data root, default plugin profile, bundled local
Node, and no V1 operational data.

| ID | Scenario | Required outcome |
| --- | --- | --- |
| `ACCEPT-MIG-020` | First launch | Local Node bootstraps through the normal protocol, onboarding creates a workspace, and no distributed terminology blocks normal use. |
| `ACCEPT-MIG-021` | Workspace/task navigation | TabRail, task panes, layout, shortcuts, command palette, and terminal drawer match V1 behavior. |
| `ACCEPT-MIG-022` | GitHub review | Browse, cache, diff, comment, review, checks, and PR lifecycle retain current interaction and offline-read behavior. |
| `ACCEPT-MIG-023` | Local coding | Worktree, Changes, Editor/Search, Notes/Context/Memory, Terminal, Preview, Docker, HTTP, and Database retain current confirmations and failure recovery. |
| `ACCEPT-MIG-024` | Agents/workflows | Create/import/resume agents, answer requests, inspect artifacts, run workflows, approve gates, cancel, and recover after restart. |
| `ACCEPT-MIG-025` | Integrations | Configure model providers, Linear, and Rollbar through plugin settings/wizards without exposing credentials to Electron. |

## Fleet acceptance

| ID | Scenario | Required outcome |
| --- | --- | --- |
| `ACCEPT-MIG-030` | Three Nodes | One local and two remote Nodes appear in one shell with distinct health and node-qualified resources. |
| `ACCEPT-MIG-031` | Unified attention | Agent requests, workflow gates, notifications, activity, and federated search identify their Node and navigate correctly. |
| `ACCEPT-MIG-032` | Same local resource ID | Two Nodes may use the same resource UUID without cache, URL, event, or command collision. |
| `ACCEPT-MIG-033` | Node loss | Disconnecting one Node leaves its cached data visibly stale and cannot affect commands or state on another Node. |
| `ACCEPT-MIG-034` | Expired cursor | A Client beyond seven days or the 256-MiB replay boundary discards dependent projections, obtains an authorized snapshot, then resumes live events without duplication. |

## Plugin acceptance

| ID | Scenario | Required outcome |
| --- | --- | --- |
| `ACCEPT-MIG-040` | Default profile | All current non-system plugins install through signed offline-seed/marketplace artifacts and reproduce V1 surfaces. |
| `ACCEPT-MIG-041` | Removal | Removing a non-system plugin respects dependants and selected data retention and does not alter core/other plugin databases. |
| `ACCEPT-MIG-042` | Community WASI | A malicious guest is denied undeclared filesystem, network, process, secret, event, and cross-plugin access. |
| `ACCEPT-MIG-043` | Native plugin | A Verified native process cannot escape its OS sandbox; a platform without enforceable sandbox support refuses installation. |
| `ACCEPT-MIG-044` | Bespoke UI | The UI cannot access Electron/Node APIs, app cookies, shared storage, navigation, service workers, arbitrary network, files, clipboard, or downloads without a specific granted bridge operation. |
| `ACCEPT-MIG-045` | Update failure | Failed health or migration causes atomic rollback and retains diagnosable state without exposing secrets. |

## Security and clean-start acceptance

| ID | Scenario | Required outcome |
| --- | --- | --- |
| `ACCEPT-MIG-050` | Pairing | Fingerprint verification and owner disclosure precede issuance of a full-authority Client certificate. |
| `ACCEPT-MIG-051` | Revocation | Revoking a Client closes streams, rejects commands, and prevents reconnect without new pairing. |
| `ACCEPT-MIG-052` | V1 immutability | V1 data-root hashes are unchanged after discovery/import/use of V2. |
| `ACCEPT-MIG-053` | API removal | `/api/v1` is absent and V1 tokens have no observable validity against V2. |
| `ACCEPT-MIG-054` | Secret handling | Credentials never appear in Client payloads, plugin storage, events, logs, diagnostics, environment variables, or plaintext backups. |
| `ACCEPT-MIG-055` | Disk policy | Node and Client refuse persistent production setup when required OS full-disk encryption cannot be established or acknowledged under the documented operator exception. |

## Cutover decision

`ACCEPT-MIG-060` V2 is releaseable only when every scenario above has platform evidence, every
current-plugin parity document is signed off, all schemas/examples validate, and the final review
report has no open critical/high finding.

`ACCEPT-MIG-061` Product management may accept a medium residual risk only when the security review
records exploit sketch, affected assets, compensating control, owner, expiry, and next action.

## Per-plugin parity evidence bundle

`ACCEPT-MIG-062` Every one of the twenty current plugins MUST publish an individual evidence bundle
before it enters the default-profile candidate. An aggregate smoke-test result cannot substitute
for an individual bundle.

Each bundle contains:

- source revision, manifest/lock digest, Node/Client/native/declarative artifact digests, contract
  digest and supported platform;
- every exercised query, command, capability, custom event and stream identifier, including
  authorization, denial, idempotency, cancellation, timeout, restart and resulting-event evidence;
- precondition and final authoritative snapshots, database/migration version, backup participation
  and uninstall/reinstall result;
- screenshots or semantic render captures for every contribution state, with shortcuts,
  navigation, focus, selection, empty/loading/stale/error/permission/unsupported states and
  responsive fallback;
- automated accessibility results plus the required keyboard and assistive-technology manual
  checks;
- settings/setup, secret-broker use, permission grant, health, update, rollback, quarantine and
  recovery evidence applicable to the plugin; and
- a mapping to every parity scenario in that plugin's `migration-and-parity.md` or simple dossier.

`ACCEPT-MIG-063` Screenshots and rendered documents MUST identify the exact artifact digest, Client
renderer-capability set, theme, viewport, locale and operating system. Visual approval against a
different build is invalid.

`ACCEPT-MIG-064` Event evidence MUST record command correlation, committed event sequence and final
snapshot. UI-only observation is not proof that authoritative state or replay behavior is correct.

`ACCEPT-MIG-065` A plugin with no bespoke UI, native artifact, secret, migration or stream MUST mark
that evidence category “not applicable” with the manifest/contract reason; the category cannot
silently disappear.

`ACCEPT-MIG-066` After all individual bundles pass, the default profile MUST produce a combined
fresh-install bundle proving contribution ordering, shortcut/route collision resolution,
cross-plugin capability delegation, Fleet behavior, startup budget and absence of undeclared
coupling.
