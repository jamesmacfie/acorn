import { createMemo, onCleanup, onMount } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { createQuery } from '@tanstack/solid-query'
import { projectsOptions, registerCommands } from '@acorn/plugin-api/client'
import { registerKeybindings } from '@acorn/plugin-api/ui/host'
import { useChangedFiles } from './changedFiles'
import { githubCommands } from './commands'

// Where this plugin's router-scoped commands get mounted, and the chords that reach them. One instance,
// in the shell's overlay slot, drawing nothing.
//
// It drew a file finder until 2026-09-03. That overlay is a `search` command on the shared palette
// session now, and what a command does is `./commands.ts`; what is left here is the router, the
// changed-file query and the keyboard. PullList still owns j/k (next/prev PR); those keys are untouched.
// The `?` shortcut opens Settings → Shortcuts rather than a local help overlay, so the reference lives
// in one place.

export default function Shortcuts(props: { onOpenShortcuts: () => void }) {
  const params = useParams()
  const navigate = useNavigate()
  const projects = createQuery(() => projectsOptions(true))
  const project = () => projects.data?.find((candidate) => candidate.id === params.projectId)
  const github = () => project()?.github

  // Current PR's changed files (same source and order PullDetail uses). Only fetched when a PR is open.
  const route = createMemo(() => {
    if (!github()?.owner || !github()?.name || !params.number) return null
    return { owner: github()!.owner, repo: github()!.name, number: params.number }
  })
  const changedFiles = useChangedFiles(route)

  onMount(() => {
    const commands = registerCommands(githubCommands({
      route,
      github,
      projectId: () => params.projectId,
      files: changedFiles.files,
      selectFile: changedFiles.selectFile,
      cycleFile: changedFiles.cycleFile,
      navigate,
      openShortcuts: props.onOpenShortcuts,
    }))
    const bindings = registerKeybindings([
      { id: 'help.shortcuts.open', command: 'help.shortcuts.open', description: 'Open keyboard shortcuts', category: 'Global', defaultChord: 'shift+?', when: 'typing-exempt' },
      { id: 'github.files.find', command: 'github.files.find', description: 'Find file in this pull request', category: 'Pull requests', defaultChord: '/', when: 'typing-exempt', active: () => !!route() },
      { id: 'github.files.next', command: 'github.files.next', description: 'Next changed file', category: 'Pull requests', defaultChord: ']', when: 'typing-exempt', active: () => !!route() },
      { id: 'github.files.previous', command: 'github.files.previous', description: 'Previous changed file', category: 'Pull requests', defaultChord: '[', when: 'typing-exempt', active: () => !!route() },
      { id: 'github.pull.create', command: 'github.pull.create', description: 'Create pull request', category: 'Pull requests', defaultChord: 'c', when: 'typing-exempt', active: () => !!params.projectId && !!github() },
    ])
    onCleanup(() => { bindings.dispose(); commands.dispose() })
  })

  return null
}
