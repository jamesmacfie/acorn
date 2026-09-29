# Manual acceptance catalog

Select checks by the runtime or feature that changed. The numbers preserve historical references;
they do not form a release checklist. Record the build, host, fixture, result, and issue for each
check you run. For the short release pass, use [the smoke checklist](../testing.md#the-smoke-checklist).

## Specialized checks

| Checks | Topic |
| --- | --- |
| 1–26, 86–88 | [Desktop and plugins](./desktop-and-plugins.md): packaged shell, third-party plugins, and bundle lifecycle. |
| 27–42 | [Terminal and palette](./terminal-and-palette.md): keyboard navigation and shared command search. |
| 43–47, 79–85 | [Changes and large surfaces](./changes-and-large-surfaces.md): commit controls, large diffs, transcripts, and task state. |
| 48–57, 65–69, 73–78 | [Workflows](./workflows.md): editor, run pane, child workflows, schedules, and typed data. |
| 58–64, 70–72 | [Agents and providers](./agents-and-providers.md): onboarding, model generation, delegation, and harnesses. |
| 89–99, 145–148 | [Rail and annotations](./rail-and-annotations.md): appearance, task markers, keyboard inspection, and plugin source visibility. |
| 100–144 | [Testing](../testing.md#the-smoke-checklist), after the smoke steps: custom agents, settings, and MCP servers. These have no file of their own yet. |

Some checks need connected providers or native dialogs. The dated results and unverified cases
remain beside their scenarios. A worktree run can use `pnpm dev:agent` for isolated data and ports;
packaged shell and native checks still need the release artifact on a graphical host.
