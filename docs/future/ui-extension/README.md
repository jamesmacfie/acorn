# Plugin UI extensions

Status: implementation plan, October 6, 2026. Implementation not started.
Analysis baseline: `0ce874a15c856db07992cc5f7650b6730c6aadaf`, including an uncommitted working tree.

This programme adds contextual plugin UI to Acorn's desktop and terminal clients. Execute the phases
in numerical order after [Editor file viewers](../editor-files.md) ships. Each phase is a developer
handoff with its own contracts, owners, verification, and completion criteria.

## Outcome and scope

Plugins can preview links, render transcript media and workflow results, add resource actions and
detail sections, annotate files and rail icons, and supply bounded document intelligence and views.
Reuse the five cooperative kinds and the menu system. Do not create a second plugin UI runtime.

Panes, sources, settings, overlays, commands, shell replacements, composer extensions, tool cards,
task annotations, and rail menus are supported foundations, not features to rebuild here.
Generated interactive reports belong to [agent-built Apps](../dynamic-ui/README.md).
Plugin contributions around or inside those apps are deferred, with a path retained in
[refused alternatives](./refused.md).

## Execution order

Every phase depends on the preceding phase. Phase 00 also depends on completed Editor file viewers.
The ordering is a delivery sequence, not a claim that every feature technically requires all earlier
features. Implementation checkpoints are not separate public releases; phase 14 completes references.

| Phase | Handoff | Status |
| --- | --- | --- |
| 00 | [Confirm prerequisites and contracts](./00-foundations.md) | Planned |
| 01 | [Add URL and reference previews](./01-link-previews.md) | Planned |
| 02 | [Add transcript media viewers](./02-transcript-media.md) | Planned |
| 03 | [Add workflow step renderers](./03-workflow-step-ui.md) | Planned |
| 04 | [Add file and document actions](./04-resource-actions.md) | Planned |
| 05 | [Add message and turn actions](./05-message-actions.md) | Planned |
| 06 | [Add resource detail regions](./06-detail-regions.md) | Planned |
| 07 | [Add file annotations](./07-file-annotations.md) | Planned |
| 08 | [Add selected-content actions](./08-selection-actions.md) | Planned |
| 09 | [Add document hover and diagnostics](./09-document-intelligence.md) | Planned |
| 10 | [Add Markdown fence viewers](./10-markdown-fences.md) | Planned |
| 11 | [Add Preview and Terminal toolbar contributions](./11-toolbar-actions.md) | Planned |
| 12 | [Add source and pane status annotations](./12-rail-status.md) | Planned |
| 13 | [Verify the combined programme](./13-acceptance.md) | Planned |
| 14 | [Update documentation and authoring examples](./14-documentation.md) | Planned |

## How to execute a phase

Read the whole handoff, its owning reference documents, and the live code before editing. Compare
`git diff 0ce874a15c856db07992cc5f7650b6730c6aadaf -- <owner paths>` with the source facts in the handoff.
Editor changes are expected. Adapt paths and private implementation details to the shipped owner;
report a conflicting public contract before inventing a replacement.

Use a supported Node runtime from the root `package.json`. Wait for a running task setup attempt
before dependency-dependent work. Do not reinstall dependencies or clear persisted state as a workaround.
Preserve unrelated working-tree edits. Do not create a branch or delegate without the user's request.

Keep tests observable: provider disabled, identity changed, late response, user invoked action, and
owner fallback. Avoid tests that merely mirror a descriptor declaration. Record commands, runtime,
host checks, and unresolved failures in the phase's delivery evidence before marking it complete.

## Architecture and decisions

[Design](./design.md) records ownership, matching, data access, and lifecycle rules.
[Refused alternatives](./refused.md) records deferrals and scope boundaries.
Public point names in the phase files are the proposed contract; finalize them in phase 00 and keep
them consistent across protocol, manifests, discovery, tests, and documentation.

## Verify before building

- Confirm the Editor replacement, toggle, revision, and confined file capability have shipped.
- Recheck [cooperative points](../../plugins/cooperative-extension-points.md),
  [remote points](../../plugins/remote-points.md), and [UI tiers](../../plugins/ui-tiers.md).
- Recheck the live desktop and terminal hosts. A shared registry alone does not prove both render.
- Keep the dynamic UI programme independent; none of these phases authorizes changing app trust.
