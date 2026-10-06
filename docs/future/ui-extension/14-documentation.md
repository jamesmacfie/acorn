# Phase 14: update documentation and authoring examples

Status: planned, October 6, 2026. Baseline: `0ce874a15c856db07992cc5f7650b6730c6aadaf`.
Depends on phase 13's completed acceptance evidence. This is the final phase.

Move implemented contracts into their owning reference documents and provide executable examples
that a plugin author can discover, build, install, and verify without this planning conversation.

## Documentation ownership

Read [writing docs](../../writing-docs.md) before editing. Keep one owner per contract; link rather
than copying API details into multiple pages. Split pages above 200 lines by topic and preserve cited anchors.

| Owner | Required update |
| --- | --- |
| [Plugin map](../../plugin-map.md) and [contribution kinds](../../contribution-kinds.md) | Complete shipped choice table, carriers, hosts, and required owner consent. |
| [Cooperative points](../../plugins/cooperative-extension-points.md) and [remote points](../../plugins/remote-points.md) | Public points, props, match keys, caps, actions, and one-level restrictions. Correct any owner-tree examples broader than the shipped SDK. |
| [Rows and annotations](../../plugins/rows-and-annotations.md) | File, source, and pane batches, opt-in, keys, limits, and legends. |
| [Menus](../../plugins/menus-and-markers.md) | File/tab, message/turn, selection targets, invocation bodies, and keyboard paths. |
| [Authoring manifest](../../plugin-authoring/the-manifest.md), [extensions](../../plugin-authoring/extensions.md), and [UI contributions](../../plugin-authoring/ui-contributions.md) | Accepted declarations, version-skew limits, matching choices, and examples. |
| [Client authoring](../../plugin-authoring/the-client-half.md) and [bridge](../../plugin-authoring/the-bridge.md) | Mounted props/actions, own-route reads, outer host regions, and disposal. |
| [Editor](../../editor.md) and [document contract](../../editor/document-surface.md) | Canonical file identity, viewers, actions, marks, selections, language routes, positions, and live revisions. |
| [Agent attachments](../../managed-agents/attachments.md) and [client UI](../../managed-agents/client-surfaces.md) | Sent versus draft media, artifact viewers, read capability, message/turn actions, and fences. |
| [Workflow UI](../../workflows/routes-and-ui.md) | Step-body projections, excluded gates/conversations, provider contribution, and fallback. |
| [Pane regions](../../panes/regions.md) | Outer loaded-owner header/footer declarations and scope. |
| [Preview shell](../../shell/webviews.md) and [Terminal client](../../terminal/client.md) | Toolbar metadata, narrow actions, person invocation, and unsupported hosts. |
| [Terminal plugin losses](../../tui/plugin-losses.md) and [terminal plugins](../../tui/plugins.md) | Actual host support and explicit alternatives to hover, frames, and native pages. |
| [Security](../../security.md) and relevant topic pages | Capability/read boundaries, supplied IDs versus grants, interaction authority, and unchanged app trust. |
| [Testing](../../testing.md) and its acceptance topic pages | Regression commands, packed examples, host matrix, and outstanding evidence if any. |

## Steps

1. Compare accepted phase contracts to live protocol, manifests, SDK declarations, discovery, and
   owner code. Write shipped behavior only. Resolve contradictions before authoring prose.
2. Update the owning pages above, adding focused topic pages if required. Add every page to
   `docs/README.md`; preserve anchors and source citations. Update test-enforced contribution tables.
3. Add examples for a task pane/menu, a tool-card replacement, an additive toolbar, a batched mark,
   a capability-backed media reader, a file viewer, a link preview, a loaded detail region, and
   document service routes. Use real accepted public props and renderer names, not proposed sketches.
4. Build/type-check examples against packed `acorn-plugin-sdk` and `acorn-plugin-types` outside the
   workspace. Parse each manifest and load at least one example of each carrier through the normal
   isolated Node/device flow. Keep example URLs/data deterministic and account-free for tests.
5. Update the scaffold and `plugin_authoring` guide so authors can find current fields, props,
   actions, language-service coordinates, host differences, and diagnostics from the running host.
   Add meaningful checks to `packages/create-acorn-plugin/index.test.ts` without changing headings
   that its example extraction relies on unless the extraction changes in the same phase.
6. Update `docs/future/README.md`, this programme's status table, and Editor/dynamic UI cross-links.
   Mark completed work with evidence and leave deferrals explicit. Do not mark dynamic UI or its
   possible companion hook shipped. Retain the programme until the owner's acceptance is complete.

## Verification

Run `pnpm --filter @acorn/arch-tests test` and full suites for the changed authoring/scaffold,
protocol/schema, and published SDK/type packages. Run `pnpm lint` if source, source comments, or
generated declarations changed. Expect exit zero. If implementation changes were needed to make an
example work, rerun phase 13's affected acceptance and complete gate before closing the programme.

Use the doc tests to check paths, anchors, source citations, page length, and contribution tables.
Follow `docs/writing-docs.md` for staging newly added docs before checks that enumerate tracked files.
Review rendered Markdown and run the literal authoring instructions from a clean package folder.

## Completion

Complete when every shipped point has one discoverable owning contract and a correct authoring path,
packed examples pass, both host support tables agree with acceptance, and the final doc gates pass.
The handoff must state what shipped, how to verify it, and any retained deferrals. No implementation
or documentation phase follows this one within the programme.

## Verify before building

- Recheck the final accepted public names and SDK exports before replacing proposed examples.
- Recheck parser-sensitive example headings and all source citation anchors.
- Stop if documentation would promise unaccepted behavior or require changing app trust or plugin API major.
