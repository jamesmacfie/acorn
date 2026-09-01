// What a path means to this shell.
//
// `../kit/router.ts` holds the path and answers `useParams`, and that is all it does: it is aliased as
// `@solidjs/router` and every plugin in the graph imports it, so it must not reach into the chrome.
// This file is the other half — the shell's reading of what the path says — and it is the same
// separation `../keys/regions.ts` keeps when it takes a pane cycler rather than importing the shell.
//
// Three readings, and the desktop has an equivalent of each. Its Router mounts a task route, its
// source registry claims a path through `sourceIdForPath`, and its URL always carries a project
// because a project-scoped surface has nowhere else to look. Here they are three effects over one
// signal.
//
// What is *not* here: which source the rail is showing. That is `selectedSource()` and it is the
// shell's, not the path's — "the shell renders from `selectedSource()`, not the location" is a rule
// this host inherits rather than invents (docs/frontend.md § Registries and plugins). A path that
// names a source moves the rail to it; choosing a source does not rewrite the path.

import { createEffect, untrack } from 'solid-js'
import { projectPath } from '@acorn/client-core/host/registries/commands/corePaths.ts'
import { sourceIdForPath } from '@acorn/client-core/host/registries/sources/sources.ts'
import { activateTaskSignals } from '@acorn/client-core/features/tasks/activate.ts'
import { selectedSource, setSelectedSource } from '@acorn/client-core/features/tasks/tasks.ts'
import { currentPath, useNavigate, useParams } from '../kit/router'
import type { ShellModel } from './model'

// Both are safe at module scope: `useParams` builds a proxy that reads the signal on every property
// access, and `useNavigate` closes over the setter. Neither needs a reactive root.
const params = useParams<{ projectId: string; taskId: string }>()
const navigate = useNavigate()

/** The project every project-scoped surface reads, as the path carries it. `null` before one is
 *  chosen, which is the state the GitHub surface answers with its own "select a project" line.
 *
 *  Read off the path when no pattern matched, rather than through `params` alone. A path is only
 *  parameters if something registered its shape, and a plugin surface nothing here knows about is
 *  still plainly a path about a project — so answering `null` for it made the effect below navigate
 *  away from the project the reader had just been looking at, on every row they moved to. The
 *  parameter is still the answer wherever there is one; this is the floor under it. */
export const routedProjectId = (): string | null => {
  const routed = params.projectId
  if (routed) return routed
  const [, prefix, project] = currentPath().split('/')
  return prefix === 'p' && project ? decodeURIComponent(project) : null
}

/** Show a project. A navigation rather than a signal of its own, because the surfaces that care read
 *  `params.projectId` and there must be exactly one place that is true. */
export const chooseProject = (projectId: string): void => { navigate(projectPath(projectId)) }

/**
 * Wire the path to the shell. Called once, from `Shell.tsx`, inside its reactive root.
 *
 * Returns nothing and disposes with the shell: every effect here is owned by the caller's root, which
 * on this host is the process.
 */
export function installRouting(model: ShellModel): void {
  // A path that names a task opens it. This is what makes promoting a pull to a task work in a
  // terminal: `PullList` finishes by navigating to the new task, and with an inert router that was a
  // task created and never shown (plugins/github/src/client/PullList.tsx).
  createEffect(() => {
    const taskId = params.taskId
    if (!taskId) return
    const task = model.allTasks().find((row) => row.id === taskId)
    if (task) activateTaskSignals(task)
  })

  // A path a source claims moves the rail onto it, so a plugin navigating into its own surface does
  // not leave the reader looking at somebody else's. The desktop asks the registry the same question
  // through the same function.
  //
  // The selection is read untracked, because this effect answers path changes and nothing else.
  // Tracked, it also ran on every Menu choice — and since choosing a source does not rewrite the
  // path, the path's owner was still the old source, and the choice was snapped straight back: once
  // a reader had browsed into any source-claimed path, the Menu stopped working.
  createEffect(() => {
    const owner = sourceIdForPath(currentPath())
    if (owner && owner !== untrack(selectedSource)) setSelectedSource(owner)
  })

  // Keep the path on a project this workspace has. Two cases, and they are the same check: nothing is
  // chosen yet, or the reader switched workspace and the path still names the old one's project.
  //
  // Opening on the first one is the courtesy the shell extends to its default Menu source. A browse
  // surface with no project is an empty screen with an explanation on it, which is worse: the reader
  // has to find `p` before anything at all works.
  createEffect(() => {
    const projects = model.workspace()?.projects ?? []
    if (!projects.length) return
    if (projects.some((project) => project.id === routedProjectId())) return
    chooseProject(projects[0].id)
  })
}
