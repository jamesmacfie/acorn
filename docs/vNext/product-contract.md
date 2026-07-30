# Product contract

**Status:** Normative<br>
**Requirement prefix:** `PROD`

## Product promise

Acorn V2 is a personal fleet of Acorn Nodes viewed and controlled from one Electron Client. The
rewrite MUST preserve the fresh-install experience of Acorn V1 while allowing each workspace to
live on the machine that owns its repository, worktree, agents, terminals, credentials, and durable
state.

`PROD-001` The Electron Client MUST operate with a bundled local Node without requiring the user to
understand or configure distributed-system concepts.

`PROD-002` The same Client MUST connect directly to remote Nodes and combine their workspaces,
agents, attention items, notifications, activity, and search results in one fleet shell.

`PROD-003` Every resource shown in an aggregate surface MUST retain its Node identity. A command MUST
target exactly one Node and MUST NOT be inferred from an unqualified local identifier.

`PROD-004` A workspace MUST belong to exactly one Node. Moving a workspace between Nodes is an
explicit export/import operation, not replication or distributed SQLite.

`PROD-005` Electron MUST remain the V2 client. Tauri migration is neither required nor designed by
this specification.

`PROD-006` Direct local and remote connections are V2 scope. A relay and mobile clients are future
products; their constraints MUST be respected by portable schemas, semantic UI, node-qualified
identity, and end-to-end transport design.

## Ownership

The Node owns:

- workspaces, repositories, tasks, worktrees, agents, terminals, workflows, integrations, and
  plugin execution;
- authoritative core and plugin databases, event outbox, files, blobs, secrets, audit records, and
  backups;
- command validation, authorization, reconciliation, and mutation commit points; and
- view-session state explicitly created by a plugin.

The Client owns:

- fleet membership metadata and last-known Node descriptors;
- layout, pane sizing, keyboard preferences, local drafts, navigation, focus, and other
  presentation state;
- verified client-side plugin artifacts and renderer implementations; and
- node-partitioned caches and event cursors.

`PROD-007` A Node MUST NOT instruct a Client to execute an unverified UI artifact. It MAY advertise a
plugin coordinate and digest that the Client resolves and verifies independently.

`PROD-008` A Client MUST NOT treat cached data as authority for a mutation. Offline mutation is
limited to locally retained drafts and operations whose contract explicitly declares safe
idempotent retry.

## Owner and devices

Acorn V2 is single-owner software. Pairing is an explicit grant of full Node authority.

`PROD-009` Every paired Client MUST have the same owner authority for Node product operations.
Fine-grained plugin permissions still constrain plugin code, but V2 has no read-only or operator
client role.

`PROD-010` Pairing UI MUST disclose full authority before the Node issues a client certificate.
Revocation MUST terminate live connections and reject future commands immediately.

`PROD-011` GitHub, marketplace, or integration identity MUST NOT serve as Acorn device identity.

## Plugin product

`PROD-012` GitHub, Terminal, and Agents MUST ship as system plugins, version-locked to the compatible
Node and Client release.

`PROD-013` All other first-party V1 features MUST be independently described and packaged as Acorn
Verified plugins. The default installation profile MUST install and enable them so a normal fresh
installation retains V1 behavior.

`PROD-014` Users MUST be able to disable or uninstall non-system plugins subject to dependency,
data-retention, and workspace-safety checks.

`PROD-015` Plugin-to-core and plugin-to-plugin behavior MUST use versioned contributions,
capabilities, commands, events, and streams. Direct imports, private endpoint calls, shared database
access, and ambient authority are prohibited.

## Visual and behavioral parity

`PROD-016` The fresh-install desktop MUST retain the V1 workspace/task hierarchy, TabRail, ordered
and resizable panes, terminal drawer, Agent Center, agent pane, command palette, settings, keyboard
model, GitHub review, changes, notes/context, editor/search, database, preview, Docker, HTTP, Linear,
Rollbar, workflows, and onboarding behavior.

`PROD-017` Monaco, xterm, diff virtualization, and `WebContentsView` are Electron implementation
details. Plugins MUST request semantic renderer capabilities rather than importing those libraries.

`PROD-018` Fleet, pairing, Node health, plugin discovery, installation, permissions, setup, updates,
quarantine, and recovery are additive V2 surfaces and MUST follow the existing keyboard-driven
desktop interaction language.

## Clean-start and compatibility

`PROD-019` V2 MUST use a separate data root and MUST NOT mutate V1 data.

`PROD-020` A one-time importer MAY copy workspace names, identity presentation, repository
membership, and repository checkout/configuration references. It MUST NOT import tasks, sessions,
terminals, notes, memories, plugin stores, tokens, credentials, event cursors, API tokens, or
presentation preferences.

`PROD-021` `/api/v1`, its bearer tokens, endpoints, event frames, and compatibility behavior MUST
not be mounted by V2. V2 MUST provide only the contracts specified under `contracts/`.

`PROD-022` Returning to V1 after trying V2 means launching the untouched V1 installation. V2 data
is not reverse-migrated.

## Release acceptance

V2 is acceptable only when:

1. a first-time user experiences the same default product capabilities as V1;
2. the same Electron Client can use one local and at least two remote Nodes concurrently;
3. Node disconnection never makes a different Node's resource appear authoritative;
4. removing a non-system plugin cannot corrupt core or another plugin's data;
5. an expired event cursor recovers through snapshot resynchronization;
6. a malicious Community plugin cannot acquire undeclared file, process, network, secret, UI, or
   cross-plugin authority;
7. a malicious bespoke UI cannot escape its isolated renderer; and
8. every current plugin and every Herdr top-100 example has a documented supported mapping or
   explicit rejection.
