# Plugin discovery, installation and permissions

Status: Normative<br>
Requirement prefix: `UX-PLUGIN`

The plugin experience explains what will run, where, under whose authority, and what remains after
removal. A coordinated Node/client install appears as one resumable owner operation.

## Discovery

- **UX-PLUGIN-001:** Plugin browser separates Acorn/System, Acorn Verified, Community and Developer
  Source trust. It never uses ranking, styling or the word “trusted” to imply Community review.
- **UX-PLUGIN-002:** A listing shows coordinate, publisher identity, version/channel, trust/runtime
  tiers, Node/client/native/bespoke artifacts, compatible platforms/protocols, dependencies,
  permissions summary, last update, provenance/SBOM/license and known revocation/security status.
- **UX-PLUGIN-003:** Search/filter includes capability, contribution, runtime, trust, platform,
  installed/update and publisher. Sponsored/curated status is distinct from security verification.
- **UX-PLUGIN-004:** Git source entry requires full commit pin or resolves a selected ref to a full
  commit before review, labels Developer Source and explains isolated build and any unsandboxed risk.

## Choose target

- **UX-PLUGIN-005:** Install starts by selecting exactly one Node. The dialog shows Node identity,
  protocol/platform, current version, relevant workspaces and disk/policy compatibility.
- **UX-PLUGIN-006:** “Install on other Nodes” is a client-orchestrated repeated workflow with
  independent locks, grants, setup, data and outcomes. It is not one distributed transaction.
- **UX-PLUGIN-007:** Electron client artifacts are acquired for the current client as part of the
  same operation. Other paired clients acquire compatible UI artifacts when they next present the
  Node and show their own partial state meanwhile.

## Review and permission

Review pages are:

1. Identity and trust evidence.
2. Artifacts/runtime and execution boundary.
3. Dependencies and version changes.
4. Requested capabilities grouped by risk/scope/purpose.
5. Data, credentials, setup, background work, network and uninstall policy.
6. Owner confirmation and operation start.

- **UX-PLUGIN-008:** Permission rows show exact operation, Node/workspace/repository/task scope,
  constraints, purpose, install/first-use/always prompt, required/optional status and denial effect.
- **UX-PLUGIN-009:** Routine read permissions may group. Secret use, external send, code write, Git
  push, terminal input, agent approval, process/native execution, each brokered credential
  purpose/destination, and unrestricted Developer Source code each receive distinct explicit
  decisions. Raw-secret access is not shown as an approvable option because every plugin request
  for it is invalid.
- **UX-PLUGIN-010:** Unsandboxed Developer Source confirmation requires typing or OS authentication
  after reading that code can access/alter local user data and credentials outside Acorn controls.
  It cannot be approved by a plugin-provided UI.
- **UX-PLUGIN-011:** Denied optional permissions preview disabled contributions. Denied required
  permission leaves a resumable installation at Awaiting permission; it does not reinterpret denial
  as approval or silently uninstall.

## Progress and completion

- **UX-PLUGIN-012:** Progress exposes Resolve, Acquire Node, Acquire Client, Verify, Permission,
  Stage, Setup, Migrate, Start, Health and Activate with completed/current/blocked/failed states.
- **UX-PLUGIN-013:** Closing Electron does not lose operation. Safe background phases continue;
  owner-input phases add attention and resume from Plugin management.
- **UX-PLUGIN-014:** Completion lists activated contributions, settings location, background work,
  granted permissions and Open/Configure/Manage actions. Partial completion names the missing client/
  Node side and exact recovery.
- **UX-PLUGIN-015:** Install/update/rollback/uninstall never disappear from history. Plugin detail
  exposes current generation, previous rollback generation, lock, grants, setup, health, storage,
  dependants and audit summary.

## Permission management

- **UX-PLUGIN-016:** Settings → Permissions is organized by Node then plugin and also supports
  capability-centric search. Effective scope and provenance are visible.
- **UX-PLUGIN-017:** Revoking shows affected contributions/in-flight work/dependants and takes
  immediate effect after host confirmation. Re-grant is a new authorization decision.
- **UX-PLUGIN-018:** Permission-use history reports high-risk operation, plugin, caller, Node,
  resource class, time and outcome without secret/body content.

## Acceptance

- **UX-PLUGIN-019:** Tests cover each trust/runtime tier, incompatible Node/client, missing other
  client artifact, required/optional denial, new update permission, source commit movement,
  unsandboxed confirmation, close/resume, partial success, dependency conflict and grant revocation.
