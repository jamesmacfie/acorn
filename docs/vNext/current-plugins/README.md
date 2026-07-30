# Current-plugin migration index

**Status:** Normative<br>
**Requirement prefix:** `CUR`

This directory specifies how every V1 plugin behaves in V2. The V1 folders are ownership hints, not
proof of runtime separation: plugins currently share a package, compiler, process graph, central
SQLite schema, and direct imports.

The cross-package [operation contract catalog](./operation-contract-catalog.md) is normative for
the complete query, command, and capability inventory and supplements each plugin's section 6.
The [operation payload catalog](./operation-payload-catalog.md) fixes the corresponding closed
request/result fields and schema-compilation rules.
The YAML manifest examples under `contracts/examples/` intentionally demonstrate primary
contribution and artifact classifications; they are not release manifests. A release manifest is
complete only after it expands every operation and event from these dossiers and the operation
catalog with digest-pinned schemas.

## Required set and disposition

| Plugin | V2 distribution | Primary split |
| --- | --- | --- |
| [Agents](./agents/README.md) | System | Node-managed drivers/state; bundled semantic Client views |
| [GitHub](./github/README.md) | System | Node provider/mirror/mutations; bundled review Client |
| [Terminal](./terminal/README.md) | System | Node PTY/session semantics; bundled terminal Client |
| [Editor](./editor/README.md) | Acorn Verified, default | Node file/search operations; built-in editor renderers |
| [Preview](./preview/README.md) | Acorn Verified, default | Node config; Electron-native browser capability |
| [Workflows](./workflows/README.md) | Acorn Verified, default | Node durable runner; Client settings/activity contributions |
| [Changes](./changes.md) | Acorn Verified, default | Node Git capability; built-in diff renderer |
| [Context](./context.md) | Acorn Verified, default | Client aggregation over Node context contributions |
| [Database](./database.md) | Acorn Verified, default | Node database broker; editor/data-grid renderers |
| [Docker](./docker.md) | Acorn Verified, default | WASI policy/parser/matcher; core-owned fixed Docker processes/streams; Client source/pane |
| [HTTP](./http.md) | Acorn Verified, default | Node request/secret broker; declarative Client |
| [Memory](./memory.md) | Acorn Verified, default | Node plugin files/index/proposals; context contribution |
| [Notes](./notes.md) | Acorn Verified, default | Node plugin files; editor/context contributions |
| [Onboarding](./onboarding.md) | Acorn Verified, default | Declarative first-run wizard |
| [Linear](./linear.md) | Acorn Verified marketplace reference | Credential-bound Node connector; declarative integration UI |
| [Rollbar](./rollbar.md) | Acorn Verified marketplace reference | Privacy-normalizing Node connector; declarative integration UI |
| [Model Providers](./model-providers.md) | Acorn Verified marketplace reference | Credential-bound generation capability |
| [Aider profile](./profiles-aider.md) | Verified executable profile | Declarative profile plus process capability |
| [Claude profile](./profiles-claude.md) | Verified executable profile | Interactive/headless profile and event adapter |
| [Codex profile](./profiles-codex.md) | Verified executable profile | Interactive/headless profile and event adapter |

`CUR-001` GitHub, Terminal, and Agents MUST be installed, enabled, signed by Acorn, version-locked to
the Node/Client release, and not independently uninstallable.

`CUR-002` Every other current plugin MUST be represented by an independently versioned Acorn
Verified package. The default profile installs and enables all applicable packages to preserve
fresh-install parity.

`CUR-003` A plugin specification MUST NOT preserve a direct implementation import merely because
both packages are Acorn Verified. Collaboration uses the same declared broker contracts required of
third-party plugins.

## Mandatory specification template

Every plugin document contains:

1. current behavior and authoritative state;
2. current UI, routes, events, contributions, and dependencies;
3. target classification, trust tier, and runtime;
4. Node, Electron, native-host, and renderer split;
5. manifest capabilities, permissions, dependencies, and optional integrations;
6. queries, commands, exported capabilities, events, and streams;
7. UI contributions and renderer requirements;
8. storage, migrations, backup, uninstall, and reinstall behavior;
9. setup, settings, health, update, and failure behavior;
10. security and credential treatment;
11. current coupling removal; and
12. exact fresh-install visual and behavioral parity scenarios.

`CUR-004` The six complex plugins use `README.md`, `node-and-data.md`, `client-and-ui.md`,
`contracts-events-and-security.md`, and `migration-and-parity.md`. Their overview MUST link all four
details and MUST NOT duplicate contradictory contract definitions.

## Cross-cutting corrections

- Changes consumes the core diff document/renderer instead of GitHub UI code.
- Database requests `acorn.code-editor` instead of importing Monaco setup.
- GitHub consumes external-reference contracts instead of Linear components.
- Notes owns its service/routes; Memory declares a Notes capability dependency.
- Context aggregates Notes/Memory/Terminal contributions without implementation imports.
- Preview invokes optional Terminal run-target capabilities rather than its client.
- Workflows owns its Client queries/actions instead of placing them under Agents.
- Terminal gives generic worktree, file, Git, process, command, and config-trust policy to core.
- Acorn device identity no longer derives from GitHub.

See [notes-memory-context-collaboration.md](./notes-memory-context-collaboration.md) for the
multi-plugin knowledge contract and
[coupling-and-extraction-map.md](../migration/coupling-and-extraction-map.md) for every current edge.

## Clean-start interpretation

`CUR-005` Plugin parity applies to a new V2 installation. V1 plugin data is not imported. Each plugin
MUST define its empty state, setup path, first successful use, and default-profile installation.

`CUR-006` Plugin parity MUST cover failures, permissions, destructive confirmations, offline state,
missing Client renderers, restart reconciliation, update rollback, and data-retention choice.
