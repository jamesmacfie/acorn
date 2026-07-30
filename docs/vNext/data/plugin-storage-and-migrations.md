# Plugin storage and migrations

Status: **Normative**
Requirement prefix: `DATA-PLUG`

## Database boundary

- **DATA-PLUG-001** A plugin receives a brokered storage API scoped to its `data.sqlite`; it does not
  receive a filesystem path or SQLite connection string.
- **DATA-PLUG-002** Each database enables the same defensive SQLite pragmas as core and has a
  maximum size from the manifest/grant, default 256 MiB and hard maximum 10 GiB.
- **DATA-PLUG-003** The host reserves table names beginning `acorn_`. Plugin tables must begin `p_`
  and be declared by migration. Dynamic SQL identifiers, `ATTACH`, `VACUUM INTO` arbitrary paths,
  loadable extensions, triggers calling host functions and writable schemas are prohibited.

## Reserved tables

| Table | Purpose |
| --- | --- |
| `acorn_meta` | coordinate, installed version, schema version, migration-chain digest |
| `acorn_migrations` | version, artifact digest, applied time, reversible flag |
| `acorn_event_sequence` | singleton plugin-local monotonically increasing sequence |
| `acorn_event_outbox` | plugin event ID/sequence/type/schema/resource/payload/sensitivity/state |
| `acorn_sagas` | optional durable broker operation and recovery cursor |

Plugin mutations and `acorn_event_outbox` inserts MUST share one plugin database transaction. The
core broker claims outbox rows idempotently, writes `plugin_event_inbox` and global `event_outbox`,
then marks the plugin event delivered. A crash at any point produces duplication, never loss.

## Migration artifacts

- **DATA-PLUG-004** Manifest migrations form a contiguous chain from current to target integer
  schema version. Each immutable artifact has a digest, maximum size 5 MiB and reversible flag.
- **DATA-PLUG-005** SQL migrations are parsed and executed by the host allowlist. They may create,
  alter, copy and drop plugin `p_` tables/indexes but may not change reserved tables, pragmas or
  filesystem state.
- **DATA-PLUG-006** WASI migration components receive only versioned row/batch storage calls and a
  60-second CPU/256 MiB memory budget; native migration executables are prohibited.
- **DATA-PLUG-007** Before update, the host checkpoints and copies the plugin database, verifies
  integrity and free disk, applies migrations while the plugin is stopped, verifies declared target
  schema and starts the candidate under a health gate.

If candidate activation fails, reversible migrations restore the exact pre-update copy and artifact.
An irreversible migration requires an encrypted backup, explicit owner acknowledgement and retains
the prior copy until the update is accepted. It cannot claim automatic rollback.

## Backup and uninstall

Manifest `backup` policy is:

- `include`: database and declared durable files enter encrypted backup;
- `exclude-cache`: host omits tables declared cache and reproducible blobs;
- `exclude-all`: allowed only if all plugin state is disposable; UI warns setup will be lost.

- **DATA-PLUG-008** Uninstall first disables the plugin and revokes grants/secrets, then retains its
  data for 30 days by default. Delete-now is explicit and cryptographically erases wrapped keys.
- **DATA-PLUG-009** Reinstall may adopt retained data only for the same coordinate and a manifest
  declaring a migration path from the retained schema. Publisher/name transfer cannot adopt it.
- **DATA-PLUG-010** Quarantine makes storage read-only to diagnostic host code and inaccessible to
  the plugin runtime.
