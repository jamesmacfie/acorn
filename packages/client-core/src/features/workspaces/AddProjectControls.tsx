import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { useQueryClient } from '@tanstack/solid-query'
import { projectsKey, tasksKey, workspacesKey, type Project } from '../../infra/queries'
import { canPickFolder, pickFolder } from '../../infra/platform'
import { activeNodeId } from '../../infra/node/activeNode'
import { canAddProjectFromFolder } from './addProject'
import { createProject } from './workspaceMutations'
import { projectImporterContributions } from '../../host/registries/sources/projectImporters'
import { Alert, Button, Input } from '../../kit/components/primitives'
import Icon from '../../kit/components/content/Icon'
import './projects.css'

/** Both Settings Overview and the empty Node use the same creation and import lifecycle. */
export default function AddProjectControls(props: { onProjectAdded?: (id: string) => void }) {
  const qc = useQueryClient()
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [path, setPath] = createSignal('')
  const [activeImporter, setActiveImporter] = createSignal<string | null>(null)
  let importerRun = 0
  const importer = () => projectImporterContributions().find((entry) => entry.id === activeImporter())
  let mounted = true
  onCleanup(() => { mounted = false })
  const node = () => activeNodeId()

  createEffect(() => {
    node()
    importerRun++
    setActiveImporter(null)
    setError('')
    setBusy(false)
  })
  createEffect(() => {
    if (!activeImporter() || importer()) return
    importerRun++
    setActiveImporter(null)
    setError('That importer was turned off or removed.')
  })

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: projectsKey }),
    qc.invalidateQueries({ queryKey: workspacesKey }),
    qc.invalidateQueries({ queryKey: tasksKey }),
  ])

  async function addFolder(folder: string) {
    const nodeId = node()
    setBusy(true)
    setError('')
    try {
      const { project } = await createProject({ path: folder })
      if (!mounted || node() !== nodeId) return
      await refresh()
      if (!mounted || node() !== nodeId) return
      setPath('')
      props.onProjectAdded?.(project.id)
    } catch (cause) {
      if (mounted && node() === nodeId) setError(cause instanceof Error ? cause.message : "Couldn't add the folder.")
    } finally {
      if (mounted && node() === nodeId) setBusy(false)
    }
  }

  async function chooseFolder() {
    const nodeId = node()
    const folder = await pickFolder()
    if (!folder || !mounted) return
    if (node() !== nodeId) return
    await addFolder(folder)
  }

  async function imported(run: number, ids: readonly string[] = []) {
    const nodeId = node()
    if (run !== importerRun) return
    setError('')
    try {
      await refresh()
      if (!mounted || node() !== nodeId || run !== importerRun) return
      if (!props.onProjectAdded) return
      const projects = qc.getQueryData<Project[]>(projectsKey) ?? []
      const selected = ids.find((id) => projects.some((project) => project.id === id))
      if (selected) props.onProjectAdded(selected)
      else setError('The importer did not report a project on this Node.')
    } catch (cause) {
      if (mounted && node() === nodeId && run === importerRun) setError(cause instanceof Error ? cause.message : "Couldn't refresh projects.")
    }
  }

  return (
    <div class="project-add-controls">
      <div class="project-add-actions">
        <Show when={canAddProjectFromFolder()}>
          <Button disabled={busy()} onPress={() => void chooseFolder()}>Add folder…</Button>
        </Show>
        {/* The native picker returns a path on this client. For a remote Node, enter a path that
            exists on the Node instead; no client path crosses the API boundary. */}
        <Show when={!canAddProjectFromFolder()}>
          <form class="project-add-path" onSubmit={(event) => { event.preventDefault(); if (path().trim()) void addFolder(path().trim()) }}>
            <Input label="Folder path on this Node" value={path()} onInput={setPath} placeholder="/absolute/path/on/node" />
            <Button submit disabled={busy() || !path().trim()}>Add project</Button>
          </form>
        </Show>
        <Show when={canAddProjectFromFolder() || !canPickFolder()}>
          <For each={projectImporterContributions()}>
            {(entry) => <Button disabled={busy()} onPress={() => { importerRun++; setActiveImporter(entry.id) }}><Icon name={entry.glyph} /> {entry.label}</Button>}
          </For>
        </Show>
      </div>
      <Show when={error()}><Alert>{error()}</Alert></Show>
      <Show keyed when={importer()}>
        {(entry) => {
          const run = importerRun
          return <section class="project-importer" aria-label={entry.label}>
            <Dynamic component={entry.component} onClose={() => { importerRun++; setActiveImporter(null) }} onImported={(ids?: readonly string[]) => void imported(run, ids)} />
          </section>
        }}
      </Show>
    </div>
  )
}
