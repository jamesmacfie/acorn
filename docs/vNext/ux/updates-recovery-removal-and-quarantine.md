# Updates, recovery, removal and quarantine

Status: Normative<br>
Requirement prefix: `UX-RECOVERY`

## Update experience

- **UX-RECOVERY-001:** Update availability shows old/new version and digest, channel, publisher/
  trust/runtime changes, dependencies, permissions, migrations, client/Node artifacts, release
  evidence and rollback support.
- **UX-RECOVERY-002:** Routine compatible updates may be automatic only when policy allows and
  permissions/trust/runtime do not broaden. Native, bespoke, permission-broadening and irreversible
  migration updates require owner review.
- **UX-RECOVERY-003:** Progress uses the same resumable lifecycle phases as install. Old generation
  remains active until new generation passes health and activation switches atomically.
- **UX-RECOVERY-004:** Restart/reopen shows current persisted operation. It never offers Update
  again while the same lifecycle lease is active.

## Failure and rollback

- **UX-RECOVERY-005:** Failure summary names phase, safe reason, active generation, data/artifact
  state, external effects and valid Retry/Rollback/Disable/Diagnostics/Uninstall actions.
- **UX-RECOVERY-006:** Rollback confirmation identifies code, dependency lock, data snapshot,
  settings/grants and uncompensated external effects. It does not claim provider actions are undone
  by SQLite restore.
- **UX-RECOVERY-007:** Automatic rollback posts a notice and history entry. Failed rollback leaves
  disabled recoverable state with both generations preserved.

## Disable and uninstall

- **UX-RECOVERY-008:** Disable is immediate/reversible and explains stopped contributions/background
  work/dependants; it retains code/data/grants unless owner separately revokes them.
- **UX-RECOVERY-009:** Uninstall review lists required/optional dependants, active streams/jobs,
  scheduled work, client/Node artifacts, storage size, secrets, settings, external resources and
  backup implications.
- **UX-RECOVERY-010:** Owner chooses Delete now, Retain for reinstall, or Export encrypted and
  delete. External provider resources require a separate explicitly named destructive command.
- **UX-RECOVERY-011:** Progress drains/cancels work, revokes grants, removes contributions/code and
  handles chosen data. Missing/failed cleanup remains visible with safe retry.
- **UX-RECOVERY-012:** Retained data appears in plugin management with coordinate, schema, size,
  sensitivity, retention and Reinstall/Purge/Export actions. Prior grants never auto-return.

## Quarantine

- **UX-RECOVERY-013:** Quarantine is visually distinct from ordinary failure and shows trusted
  reason category, affected Node/plugin/generation, containment already applied and evidence-safe
  recovery actions.
- **UX-RECOVERY-014:** Integrity, publisher revocation or sandbox-escape quarantine does not offer
  an ordinary Restart. Valid actions are verified update, reduced permissions where applicable,
  export diagnostics, disable, uninstall and security-approved override only if policy explicitly
  supports it.
- **UX-RECOVERY-015:** Dependants show Blocked by quarantined `<plugin>` without inheriting a
  quarantine badge absent their own evidence.
- **UX-RECOVERY-016:** Diagnostic export previews categories, applies redaction, encrypts output and
  excludes wholesale databases/secrets.

## Node/client recovery

- **UX-RECOVERY-017:** Node identity mismatch, incompatible protocol, lost device, local Node start
  failure, corrupted plugin data and expired event cursor each have distinct recovery flows.
- **UX-RECOVERY-018:** Recovery never silently creates a new Node identity/data root, trusts a new
  fingerprint, downgrades security, reuses V1 credentials or discards failed state. Backup Restore
  explicitly states that it always creates a new Node/trust domain and requires re-pairing; cancel
  leaves the existing root and backup untouched.
- **UX-RECOVERY-019:** Backup restore shows backup identity/time/Node/plugin/schema, verifies
  integrity/decryption/compatibility into staging, previews old-to-new resource mapping and switches
  only after health checks.

## Acceptance

- **UX-RECOVERY-020:** Tests fail every lifecycle phase, interrupt rollback/uninstall/purge,
  quarantine every trigger class, remove required/optional dependency, restore incompatible/
  corrupted backup and prove accurate residual-state and recovery actions.
