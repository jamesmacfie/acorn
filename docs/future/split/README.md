# Keep the Node, client, and plugin splits honest

Date: October 14, 2026. Status: phases 1 to 9 implemented October 15, 2026. Phase 10, the remote preview proxy, is proposed.
The plans for phases 1 to 8 were removed on October 20, 2026, and are in Git history at commit
`ffe59144b`, under `docs/future/split/`. Phase 9 stays, because phase 10 builds on its spike.

This programme fixes the places where acorn's two founding splits have drifted. The first split is
the Node and the client: the Node owns data and execution, and a client on another machine presents
it. The second is core and plugins: core supplies extension points, and plugins supply features.
Read this page before you pick up a phase.

This folder isn't the plan in [split.md](../split.md). That file covers moving loaded plugins into
their own repositories. The two share a word and nothing else.

## Why this exists

Every test and every manual check runs the Node and the client on one machine. A "second Node" in the
smoke checklist is another process on the same Mac, with the same filesystem and the same build. Code
that quietly assumes one machine still passes. A review on October 14, 2026 found these gaps:

- Three folder pickers send a path from the client's disk to a remote Node.
- The standalone Node tarball ships none of the seven bundled loaded plugins.
- 60 routes left the route snapshot after the September 24, 2026 cutoff while the protocol stayed at
  version 1, which promises that changes only add things.
- Docker copies `localhost` addresses and shell commands that mean the Node's machine.
- The preview pane is blocked on remote Nodes, with nothing in its place.

The core and plugin split holds at the import level, because `tools/arch/boundaries.test.ts`
enforces it. It drifts at the level of meaning:

- GitHub is part of core's data model. Projects, tasks, worktree checkout, agent context, and the
  published plugin types all speak GitHub. A GitLab or Bitbucket plugin can't give the same
  experience without core edits.
- The `@acorn/plugin-api` facade exports 664 names, and 278 of them have exactly one consumer. Some
  of those are a plugin's internals living in core.
- The CLI and the two app shells hardcode the agents, workflows, and terminal plugins in ways the
  docs don't list.

GitHub keeps shipping with acorn as a compiled plugin. The goal is that a GitLab or Bitbucket plugin
can build the same experience on the same seams, with no core edit.

## The phases

| Phase | What changes |
| --- | --- |
| 1 | The standalone Node ships and reconciles the same loaded plugins as the desktop. |
| 2 | A second Node runs in a container, so remote checks use a different filesystem. |
| 3 | Folder pickers and copied addresses respect which machine the Node is on. |
| 4 | The Node reports its build, clients show a mismatch, and a route removal fails a test. |
| 5 | A code host contribution owns repository identity, replacing core's GitHub columns. |
| 6 | Pull requests become provider-owned change requests, including checkout and the default pane. |
| 7 | Single-consumer and unused facade exports move to their owners or go. |
| 8 | The CLI and shells import plugin contracts through a listed, tested set. |
| [9](./09-remote-preview.md) | A spike decides how a remote Node's preview reaches the desktop safely. |
| [10](./10-remote-preview-proxy.md) | The Node proxies a remote preview to a confined loopback origin on the desktop. |

## Order and dependencies

Phases 1 and 2 come first, because every later phase checks its result against a remote Node. Phase 2
needs phase 1, or the container Node is missing half its features.

Phase 3 is small and fixes visible bugs, so take it right after the rig. Phase 4 is independent and
can run beside phase 3.

Phase 5 must land before phase 6. Both change stored data and the published plugin types, so plan
them together even if they ship apart. Each keeps the GitHub-named fields readable until the next
plugin API major, as [forward compatibility](../../plugins/forward-compatibility.md) describes.

Phases 7 and 8 are cleanup with no data changes. Take them whenever there is room. Phase 9 was a
design spike. It decided to build, and phase 10 is that build.

## What this programme leaves to others

Key custody on a standalone Node is open finding R21 in the
[October 11 security review](../../security/review-2026-10-11.md). The container image for hosted
Nodes is [cloud phase 1](../cloud/01-node-image.md). Phase 2 here reuses its local Docker
half rather than writing a second image.
