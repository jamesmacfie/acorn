# Phase 00: confirm prerequisites and contracts

Status: planned, October 6, 2026. Baseline: `0ce874a15c856db07992cc5f7650b6730c6aadaf`.
Depends on completed [Editor file viewers](../editor-files.md). Execute before phase 01.

This phase records the post-Editor baseline and establishes the contracts and verification inventory
for contextual UI. It does not introduce an unused extension framework.

## Starting point and owners

`packages/protocol/src/chrome/extensionPoints.ts` defines five kinds and shared point props.
`packages/protocol/src/plugin/manifest/extensionDescriptors.ts` parses declarations.
`packages/node-core/src/server/plugins/manifestValidation/extensions.ts` checks owner/carrier rules.
`packages/client-core/src/host/tree/Slot.tsx` mounts compiled components or remote trees.
`packages/client-core/src/host/registries/extensionPoints/extensionPoints.ts` owns registrations.
`packages/plugin-sdk/src/remote/public.ts` exposes a chrome-only `Slot({ slotRef })`.

The baseline has no Editor client point. The prerequisite must have supplied `editor:document`, live
text/revision props, an owner-held source toggle, fallback rendering, and confined read-only bytes.
Its matching key must remain separate from the case-preserving worktree-relative `path`.

Read [UI tiers](../../plugins/ui-tiers.md), [remote points](../../plugins/remote-points.md),
[the manifest](../../plugin-authoring/the-manifest.md), and [testing](../../testing.md).

## Steps

1. Compare the live source with the baseline. Record the Editor point declaration, public capability
   name/types, Node confinement, text versus disk behavior, and revision semantics in delivery evidence.
   Test an unsaved Markdown preview, source return, tab switch, and Node switch in both supported hosts.
2. Confirm shipped UI contributions rather than copying the earlier conversation inventory. Distinguish
   client-only compiled contributions from loaded declarations. Confirm rail menus have integrated.
3. Finalize the proposed names from the following phases. Declare owner-specific props beside their
   owner, promoting only contracts that core consumers need into protocol. Do not put plugin names
   or imports into core to special-case a contributor.
4. Record per-phase package/test ownership and a small loaded example strategy. Extend test fixtures
   or plugin scaffolds when possible; do not install permanent example plugins into production rosters.
5. Confirm discovery reports point kind, matching, declared actions, absent owners, and renderer errors.
   Add coverage only for a demonstrated missing behavior; no source changes are required if it works.

## Contract decisions

Use `replace` for viewers and `stack` with a cap for additive UI. Preserve arbitration ties and picks.
Use host menus for actions and batched annotations for marks. Nested cooperative tree slots remain
unsupported. Every read uses the contributor's own route or a declared Node capability.

This programme keeps API major 3 unless an incompatible contract is found. It does not assume that
every major-3 host understands vocabulary added by later phases. Schemas and authoring discovery
must tell authors which declarations this running host accepts.

## Verify and complete

Run these commands on the supported runtime and expect exit zero:

```sh
pnpm test:focus @acorn/client-core src/host/tree/Slot.test.tsx
pnpm test:focus @acorn/node-core src/server/plugins/manifest.test.ts
pnpm test --filter=@acorn/plugin-editor
pnpm --filter @acorn/arch-tests test
```

Complete when Editor evidence and the point/consumer inventory are recorded, the live source confirms
one-level remote composition, and the commands pass. If source changes were needed, also run
`pnpm lint` and the changed packages' full suites and direct consumers.

## Scope and stop conditions

Do not rebuild Editor viewers, change app trust, clear persisted state, or introduce generalized
resource services. Stop if the prerequisite is incomplete or its public contract conflicts with a
later requirement. Resolve that contract before moving to phase 01.

## Verify before building

- Recheck Editor fallback and dirty-buffer ownership after upstream work lands.
- Confirm `Slot` arbitration and action limits in the running source.
- Confirm task setup has settled and the Node runtime meets root `package.json`.
