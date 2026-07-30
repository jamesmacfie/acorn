# Uninstall, data retention and reinstall

Status: Normative<br>
Requirement prefix: `PLUG-REMOVE`

Disable, uninstall and purge are different operations:

- **Disable** stops execution and contributions while retaining installation and data.
- **Uninstall** removes active code and grants, with an explicit data decision.
- **Purge** irreversibly deletes retained plugin data and plugin-specific cryptographic material.

## Uninstall

- **PLUG-REMOVE-001:** Uninstall requires lifecycle revision and owner authorization, shows
  dependants, active work, external resources, retained data size, secrets, scheduled work and
  rollback implications.
- **PLUG-REMOVE-002:** Required dependants block uninstall until the owner disables/uninstalls them
  or selects an ordered cascade. Optional dependants lose only dependent contributions.
- **PLUG-REMOVE-003:** The operation rejects new work, drains/cancels in-flight work, revokes
  handles, stops runtime/process tree, unregisters contributions, removes subscriptions/schedules,
  revokes grants and then removes executable artifacts not referenced elsewhere.
- **PLUG-REMOVE-004:** The plugin MAY execute a declared bounded pre-uninstall export but cannot
  veto uninstall. Failure is shown and core continues with safe containment.
- **PLUG-REMOVE-005:** External provider resources are never deleted merely because local plugin
  code is removed. A separate named destructive command and confirmation is required.
- **PLUG-REMOVE-006:** Plugin-owned secret references are disabled at uninstall. Shared provider
  secrets remain if still referenced; exclusive secrets are deleted or retained according to the
  explicit owner selection.

## Data choices

| Choice | Result |
| --- | --- |
| `delete-now` | plugin DB/blobs/settings/setup state removed after recovery window policy |
| `retain` | encrypted data retained without executable activation |
| `export-and-delete` | encrypted schema-described export, then delete after verified export |

- **PLUG-REMOVE-007:** The default is the signed manifest policy, but the confirmation MUST show the
  effective choice and permit a safer owner override unless Node policy requires deletion.
- **PLUG-REMOVE-008:** Retained data records coordinate, schema version, size, sensitivity,
  encryption key reference, retain-until policy and compatible reinstall ranges. It is inaccessible
  to other plugins.
- **PLUG-REMOVE-009:** Purge deletes plugin database, blobs, installation settings, wizard answers,
  exclusive secret material, derived cache and plugin encryption key. Minimal security/audit tombstone
  remains under the Node audit retention policy and contains no plugin content.
- **PLUG-REMOVE-010:** Deletion is idempotent and restart-safe. Missing files are recorded, not
  treated as evidence that every data class was purged.
- **PLUG-REMOVE-011:** Backups containing purged data remain governed by backup retention and
  cryptographic erasure policy. The UI MUST state that offline backups may retain encrypted history.

## Reinstall

- **PLUG-REMOVE-012:** Reinstall discovers retained data only for the exact publisher/name identity.
  A renamed or differently signed plugin cannot adopt it without an explicit signed migration.
- **PLUG-REMOVE-013:** Before reuse, the installer verifies compatible schema/migration path,
  integrity, required secrets/connections and setup postconditions. It snapshots retained data before
  migration.
- **PLUG-REMOVE-014:** Prior grants are not restored automatically. The manifest's current
  permissions are reviewed and newly granted.
- **PLUG-REMOVE-015:** Retained settings may be restored after validation; secret references are
  reused only if the owner confirms and the vault reports them healthy.
- **PLUG-REMOVE-016:** Unknown persisted pane/source IDs remain in client layouts as unavailable
  placeholders and become live again only after compatible contribution activation.

## Acceptance

- **PLUG-REMOVE-017:** Tests MUST cover required and optional dependants, crash during each phase,
  running streams/jobs, shared and exclusive secrets, retain/reinstall across compatible and
  incompatible versions, export failure, backup disclosure, purge idempotency and reinstall without
  grant resurrection.
