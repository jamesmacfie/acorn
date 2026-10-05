# Phase 04: resolve the bundled Claude executable payload

Completion note, October 6, 2026: **retained** the SDK's optional Claude binary in desktop staging.
The locked adapter normally selects Acorn's resolved host CLI, but it applies managed-policy
environment values after receiving that path. A policy can clear the override and reach the SDK's
bundled fallback, so omission would change a supported path. The local `claude` 2.1.289 auth probe
reported `loggedIn: true` outside the sandbox; no staged turn was needed for this retention decision.
No package, staging policy, lockfile, or shipped contract changed, and realized savings are zero.
The source trace and baseline tests are recorded in
[evidence](./evidence.md#phase-04-bundled-claude-payload-2026-10-06). Phase 05
can proceed independently. A later omission needs real SDK closure and authenticated staged launch,
resume, and cleanup evidence; recheck adapter executable selection and SDK path resolution at the
locked versions before changing the package-specific staging policy.

Date: 2026-10-06. Status: DONE (retention). Risk: high if omission is wrong; bounded decision used.
Prerequisite: accepted [phase 03](./03-native-payload.md). Next: [phase 05](./05-keymap.md).
Planning revision: `2ae55abb5`; use the current adapter/SDK versions from the accepted lockfile.

## Task and context

Determine whether desktop staging can safely omit the SDK's optional bundled Claude executable.
The audit observed a 216.7 MiB macOS arm64 binary inside the adapter's 244.8 MiB installed closure.
Acorn's Claude harness declares a required external `claude` command and passes its resolved path as
`CLAUDE_CODE_EXECUTABLE`. The adapter appeared to prefer that override, but all launch/resume paths
and SDK initialization must be verified before changing shipped files.

This task may finish with an evidenced retention decision. A third-party binary must remain if its
omission changes supported behavior or cannot be established safely. Do not weaken launch guarantees.

## Owners and boundaries

- `plugins/agents/src/server/drivers/claudeHarness.ts`: stable `claude` provider and `claude-code`
  profile IDs, launch entry, required CLI, passthrough env, unattended/resume metadata.
- `plugins/agents/src/server/drivers/harness.ts`, `acpDriver.ts`, `acpSession.ts`, `authProbe.ts`.
- Installed `@agentclientprotocol/claude-agent-acp` and its Claude Agent SDK: inspect real source and
  manifests at the locked versions. If documentation is needed, verify current upstream sources.
- `apps/desktop/scripts/stage-runtime-dependencies.mjs`, its tests, and phase 03's file policy.
- `scripts/pack-node.mjs`: standalone npm installs are a separate delivery path and remain intact.

The adapter and SDK remain dependencies. This is a desktop staging decision, not global optional
dependency removal, a provider rewrite, a CLI auto-install feature, or a library version upgrade.

## Implementation steps

1. Trace required-command resolution through driver spawn to the child environment. Inventory every
   first-party path that loads this SDK/adapter, including authentication probes, resume, workflow,
   delegated sessions, and contributed harnesses using their own package directories.
2. Read SDK initialization and adapter executable selection. Record whether the optional binary is
   eagerly imported, used for anything beyond spawning, or selected if the override is missing.
   Check licensing/distribution requirements before changing copied files.
3. Write a dated decision in `evidence.md`: omit only if all supported desktop entrypoints supply a
   validated executable path before SDK use and neither import nor supported fallback needs the
   binary. Otherwise retain it with exact blocking paths and estimated benefit/maintenance cost.
4. If omission is justified, extend the package-specific staging policy. Preserve SDK JS, schemas,
   adapter code, licenses, unrelated optional packages, and package-resolution semantics. Match
   known binary package identities/layouts, with explicit handling when upstream layout changes.
5. Add isolated packaging proof: stage the real adapter/SDK closure without that executable outside
   the checkout, load the real SDK, and prove the launch reaches the supplied CLI path. A fake ACP
   adapter alone cannot prove the SDK is independent of its binary. Use controlled process fixtures
   for deterministic executable/env assertions, missing-command failures, cancellation, and resume.
6. Where an authenticated Claude CLI is available, run a minimal managed interactive turn and resume
   from staged resources; also verify unattended metadata and cleanup. Record CLI/adapter/SDK versions.
   If this essential evidence is unavailable, retain the binary and record why omission is unproven.
7. Re-measure actual staged helper bytes and compressed artifacts if already produced. Keep npm
   standalone behavior and its optional dependency graph unchanged. Add a maintenance note identifying
   the upstream behavior to recheck on future upgrades.

## Verification

```sh
pnpm test:focus @acorn/desktop scripts/stage-runtime-dependencies.test.mjs
pnpm test:focus @acorn/plugin-agents src/server/drivers/acpDriver.test.ts
pnpm test:focus @acorn/plugin-agents src/server/drivers/processOwnership.test.ts
pnpm lint
pnpm test --filter=@acorn/plugin-agents --filter=@acorn/node --filter=@acorn/desktop
pnpm --filter @acorn/arch-tests test
pnpm --filter @acorn/desktop build
pnpm pack:node
```

For retention without code changes, record the source trace and baseline test evidence; rebuilding
unchanged artifacts is unnecessary. For omission, all listed code gates and real staging proof apply.

## Acceptance and handoff

Either safe omission ships with the above proof and measured savings, or a retention decision lists
the exact unsupported assumptions and keeps the binary. Both outcomes unblock phase 05. Record
which outcome happened; never report prospective savings as realized. Restore the staging policy
if launch semantics differ. No database, profile ID, public driver contract, or npm policy changes.

## Verify before building

Re-read the locked third-party implementation, current driver paths, and phase 03's staging policy.
Stop omission on any unproven SDK path or missing required launch evidence; complete the retention
decision instead of inventing a fallback or creating an unreviewed vendor fork.
