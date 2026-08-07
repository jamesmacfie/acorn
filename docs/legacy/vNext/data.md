# Data

## Node data root

One directory per Node (packaged: platform data dir; dev: `apps/node/.acorn/`), mode 0700, with an
exclusive lock file so two Node processes can't share it:

```text
<data-root>/
├── core.sqlite            core DB (Drizzle, WAL, FK on)
├── plugins/<name>.sqlite  one DB per plugin
├── blobs/<sha256>         content-addressed immutable blob store
├── secrets.key            fallback encryption key (0600) — used only where no OS
│                          keychain exists (headless Linux); macOS uses the keychain
│                          and this file is absent; dev uses .env
├── node.json              nodeId, cert paths, created-at
└── logs/
```

vNext never opens a V1 data root. If the configured root resolves inside one, startup fails with a
clear error.

## Core DB

Owned by `@acorn/node-core`, migrated by Drizzle on startup (V1's exact workflow: edit schema →
`db:generate` → migrate on boot). Core tables:

- `devices` — paired clients: id, name, tokenHash, createdAt, lastSeenAt, revokedAt.
- `workspaces`, `workspace_repos`, `repo_paths` — same shapes as V1 (repo config lives on the
  repo, per V1's repo-level settings decision).
- `tasks` — workspace, repo, branch, worktree path, origin, status.
- `config_acks` — hash-gated trust of executable repo config, as in V1.
- `settings` — node-scoped settings (scope precedence: default → node → workspace → repo → task;
  client presentation settings stay on the client).
- `secrets` — encrypted credential records (see security.md).
- `operations` — long-running mutations: id, kind, state, startedAt, finishedAt, error. Recovery
  scan on startup marks orphaned `running` operations `interrupted`; each owner decides retry vs
  surface-to-user. This is the whole "saga framework": a table and a startup scan.
- `idempotency` — (deviceId, key) → request hash + stored response, 24h TTL.
- `audit` — append-only security-relevant actions (see security.md), 90-day retention.

The V1 monolithic DB is dismantled: GitHub mirror tables go to the github plugin DB, agent tables
to agents, terminal/notes/memory/http/workflow tables to their plugins. Core keeps only the tables
above. `api_tokens` / `api_idempotency` (the `/api/v1` automation surface) are dropped without
replacement.

## Plugin DBs

- Each plugin gets its own SQLite file, opened and migrated by core's storage service at plugin
  init. The plugin owns its schema and its Drizzle migration chain.
- No cross-DB queries, no ATTACH, no foreign keys across files. Cross-plugin references are plain
  IDs, validated by the owning plugin when dereferenced.
- Transactions never span DBs. If a flow touches core + a plugin (or two plugins), it's an
  `operations` row with explicit steps and idempotent retry — visible intermediate state is
  acceptable and honest.
- Disabling a plugin leaves its DB in place. Data deletion is an explicit user action.

## Client cache

The client keeps, per node, a disposable query cache (the V1 TanStack Query + IndexedDB
persistence model, now keyed by `(nodeId, queryKey)`):

- Never authoritative; never synced back; safe to wipe at any time.
- Every cached entry renders with freshness (live / stale / offline) derived from node connection
  state and `observedAt`.
- Client-durable state that is *not* cache: fleet membership (node endpoints, pinned fingerprints,
  labels), layouts and pane weights (keyed by nodeId + task), presentation prefs, drafts. Device
  tokens live in the OS keychain — **satisfied by Electron `safeStorage`**, which on macOS stores its
  key in the Keychain and encrypts with it. So this line needs no `keytar`-class native dependency;
  `apps/desktop/src/app/main/deviceTokenStore.ts` is one 0600 `safeStorage` blob per scope, where a
  scope is a nodeId (plus the constant `local` for the bundled node, whose token must be read before
  its nodeId is knowable). Membership lives beside it in `fleet.json` rather than inside it, so a
  machine with no usable keychain keeps its fleet and simply re-pairs instead of losing both.

The partition is implemented as **one `QueryClient` + one IndexedDB persister key per node**
(`client-core/node/fleet.ts`), not as a nodeId prefix on every query key. Same guarantee — two nodes
holding the same UUID cannot collide — reached by construction rather than by every one of the 34
query-option factories remembering a convention.

**Known Phase 1 divergence — presentation prefs are stored on a node.** ui.md § State ownership says
the client owns theme, style pack, keybindings and layout, but they live in the node's flat
`/v2/core/prefs` record (a single-node inheritance). Left there for Phase 1 and pinned to the **home
node**: `prefsOptions` and `savePref` address that node explicitly whatever node is active, so
switching nodes cannot flip the user's theme. A real client-side device-prefs tier is Phase 4.
- Unsent drafts (comment text, dirty editors) are client-local and survive navigation but not
  necessarily restart — same rules as V1.

## Blobs

Content-addressed by sha256, immutable, shared across plugins on the same node (patches, file
bodies, attachments, artifacts). Size-capped LRU pruning, except shas referenced by plugin rows
that declare retention (e.g. agent artifacts). This is V1's blob cache, unchanged in spirit.

## Retention defaults

| Data | Retention |
| --- | --- |
| Idempotency records | 24 h |
| Completed `operations` rows | 7 days |
| Terminal replay tail | per session, 256 KiB + framebuffer |
| Disabled-plugin DBs | until user deletes |
| Audit records | 90 days |
| Logs | 14 days, size-capped |

## Backup

Keep it boring: the Node exposes `POST /v2/core/backup` which uses the SQLite online-backup API to
snapshot core + plugin DBs and the blob index into a single archive in a user-chosen location,
**excluding** `secrets`, device tokens, and the TLS key. Restore is a manual operation into a
fresh data root: secrets and pairings are re-entered, because restoring credentials from a file
that might travel is exactly the risk we don't want. Everything else (worktrees, general data)
relies on macOS FileVault + the user's own machine backups, and the app surfaces a one-time warning
if the disk isn't encrypted.
