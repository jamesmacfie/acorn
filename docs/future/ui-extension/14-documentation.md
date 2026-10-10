# Phase 14: update documentation and authoring examples

Status: done, October 10, 2026. Branch `phase-14-documentation`, from `dbe474439`. Planned October 6,
2026, from `0ce874a15c856db07992cc5f7650b6730c6aadaf`. This is the final phase.

## Completion note

Every shipped point has an owning reference page, one list that `plugin_authoring` reads, and a tested
example. The programme folder stays until its open acceptance is done
([the programme's status](./README.md#open-acceptance-and-deferrals)).

### What landed

- **The point list for `plugin_authoring`.** `packages/protocol/src/chrome/publicExtensionPoints.ts`
  lists all 29 public points with kind, mode, cap, actions, key, props, and terminal differences. The
  guide renders it and the vocabulary returns it as `points`, so an agent can discover
  `editor:document`. `apps/desktop/test/client/publicExtensionPoints.test.ts` activates every client
  plugin and fails when a registered point is missing or differs. `pluginConfigs.test.ts` in
  `apps/node` does the same for Linear's and Rollbar's manifest points. This closes phase 00's
  open issue. The guide was 30,381 bytes, so its context-section ceiling went from 32,000 to 40,000.
- **The extension example.** `docs/plugin-authoring/extension-example.md` and its Node and tree pages
  are one package, `acme-review`, that fills the nine places the plan named. A
  `create-acorn-plugin` test writes it from the pages, builds it with Vite against the packed SDK and
  types, type-checks it under `strict`, runs the bundle and checks its `tree:ready` entries against
  the manifest, and calls every route.
- **Real host.** The built example was installed into `pnpm dev:agent`. The pane, the file menu row,
  the file mark, the CSV viewer, hover, diagnostics, the link preview, and the terminal toolbar
  control all drew ([acceptance record](../../testing/ui-extension-acceptance-2026-10-10.md)).
- **Reference pages.** [Places to fill](../../contribution-kinds.md#places-to-fill) is the shipped
  choice table, with carrier, consent, and terminal support. Link previews moved to
  [their own page](../../plugins/link-previews.md), with an anchor left in remote points.
  Context menus, manifest rules, extensions, the client half, the bridge, pane regions, the terminal
  drawer, terminal losses, the client sandbox, Editor, and agent client surfaces each gained their
  part. The scaffold's `README.md` names the three places a running host lists points.
- **Closing out.** The phase 13 matrix and open checks moved to the dated acceptance record. The
  programme README, the future index, `docs/README.md`, and the dynamic UI cross-link say what
  shipped and what stays open or deferred.

### Decisions and deviations

- **A hand-kept list, checked against the registry.** The Node can't import client registrations, so
  the list lives in protocol beside the other contracts both ends read. Kind, mode, cap, actions, and
  key are tested against the registry. Props and terminal notes are prose an agent reads, so they
  aren't. Protocol's entrypoint ceiling in `tools/arch/boundaries.test.ts` moves from 83 to 84.
- **Examples as doc fences.** The repository's pattern is pages that a test extracts, as
  `complete-example.md` does, so the code an author copies is the code that's built. A tree needs a
  bundle, so the example has a Vite build and a plain JavaScript Node half.
- **`context:section` is compiled-only.** Its props carry two callbacks, which can't cross to a
  worker, so a loaded tree there fails to mount. The list says so. Nothing changed in the owner.
- **The SDK isn't on npm.** Neither `acorn-plugin-sdk` nor `acorn-plugin-types` is published, so the
  example installs both from packed tarballs. The bridge page no longer says to `npm install` the SDK.
  `packages/plugin-sdk/README.md` and the data-source scaffold's dependencies still name the
  registry. Publishing is outside this programme.
- **Owner-tree example corrected.** Remote points showed a manifest-declared owner drawing
  `<Slot point>`, which only a compiled owner can do, and used `selector`, which nothing reads.
- **The real-host check overrode `document.hidden`.** The `dev:agent` window reports itself hidden,
  and `bumpChrome` skips a plugin's push then, so marks didn't refresh until the override.
- The tool card, CSV artifact, and Linear region weren't drawn in the real host. They need an agent
  turn, a `text/csv` artifact, and a Linear connection. The example's terminal behavior wasn't driven.

### Verification

Run with Node 26.8.1.

- `pnpm test`: the 23 failures are phase 13's known reds and nothing else. They are the 15 dead links
  in `docPaths`, four `EditorPane.test.tsx` status-menu tests, the `generate.test.ts` kind fallback,
  `managedBridge.test.ts`, two `chrome.test.tsx` marker tests, `persistedState.conformance.test.ts`,
  and nine `@acorn/node` golden and loader tests. `create-acorn-plugin` (24),
  `pluginAuthoring.test.ts` (17), `pluginConfigs.test.ts` (10), and
  `publicExtensionPoints.test.ts` pass. Changing one cap in the list fails the registry test.
- `pnpm --filter @acorn/arch-tests test`: only the known 15 dead links. Every page stays under 200
  lines, and the citations moved with the link previews section.
- `tsc` is clean for protocol and node-core, and the desktop and Node packages show only the known
  agents, changes, git, and workflows errors. oxlint flags nothing in the changed files.
- Budgets: service 1,757,602 of 1,759,000 B and terminal startup 692,304 of 700,000 B, unchanged.
- The example was built the way an author builds it, with `npm install` from packed tarballs, in
  `/tmp`. Nothing from that build, the scratch install, or the scratch files is committed.

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
