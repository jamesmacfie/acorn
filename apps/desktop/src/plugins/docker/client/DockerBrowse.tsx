// The Docker rail Source (docs/plugins.md): OrbStack-style master/detail. Left column groups
// containers by compose project (running groups first, a Stopped section below) with a segmented
// sub-nav for Images / Volumes / Networks; the right pane is the shared ContainerDetail. Refresh
// is event-driven — the store re-fetches on `docker:changed`.
import { createQuery } from '@tanstack/solid-query'
import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { prefsOptions } from '../../../core/client/queries'
import { wsOnDockerChanged } from '../../../core/client/wsClient'
import { readDockerPrefs } from './dockerPrefs'
import type { DockerComposeAction, DockerContainerSummary, DockerPruneKind } from '../shared/model'
import { composeAction, containerAction, dockerPrune, fetchImages, fetchNetworks, fetchVolumes, removeContainer, removeImage, removeNetwork, removeVolume } from './dockerClient'
import { containers, dockerInfo, loadError, loading, refreshDocker, wireDockerRefresh } from './dockerStore'
import ContainerDetail from './ContainerDetail'
import './docker.css'

type Section = 'containers' | 'images' | 'volumes' | 'networks'
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'containers', label: 'Containers' },
  { id: 'images', label: 'Images' },
  { id: 'volumes', label: 'Volumes' },
  { id: 'networks', label: 'Networks' },
]
// Docker's built-in networks can't be removed.
const BUILTIN_NETWORKS = new Set(['bridge', 'host', 'none'])

type Group = { project: string | null; containers: DockerContainerSummary[]; running: number }

const isActive = (c: DockerContainerSummary): boolean => c.state === 'running' || c.state === 'paused' || c.state === 'restarting'

function groupContainers(list: DockerContainerSummary[]): Group[] {
  const byProject = new Map<string, DockerContainerSummary[]>()
  const loose: DockerContainerSummary[] = []
  for (const c of list) {
    if (c.composeProject) {
      const arr = byProject.get(c.composeProject) ?? []
      arr.push(c)
      byProject.set(c.composeProject, arr)
    } else loose.push(c)
  }
  const groups: Group[] = [...byProject.entries()].map(([project, cs]) => ({
    project,
    containers: cs.sort((a, b) => (a.composeService ?? a.name).localeCompare(b.composeService ?? b.name)),
    running: cs.filter(isActive).length,
  }))
  for (const c of loose) groups.push({ project: null, containers: [c], running: isActive(c) ? 1 : 0 })
  return groups.sort((a, b) => (b.running > 0 ? 1 : 0) - (a.running > 0 ? 1 : 0) || label(a).localeCompare(label(b)))
}

const label = (g: Group): string => g.project ?? g.containers[0]?.name ?? ''

export default function DockerBrowse() {
  const [section, setSection] = createSignal<Section>('containers')
  const [selected, setSelected] = createSignal<string | null>(null)
  const [filter, setFilter] = createSignal('')
  const [collapsed, setCollapsed] = createSignal<Set<string>>(new Set())
  const [rowBusy, setRowBusy] = createSignal<string | null>(null)
  const [confirmRm, setConfirmRm] = createSignal<string | null>(null)
  const [groupBusy, setGroupBusy] = createSignal<string | null>(null)
  const [actionError, setActionError] = createSignal('')
  const [pruneNote, setPruneNote] = createSignal('')

  onMount(() => {
    wireDockerRefresh()
    void refreshDocker()
  })

  // Object lists load on section entry and refresh on their docker:changed scope.
  const [images, imagesCtl] = createResource(() => (section() === 'images' ? 'images' : null), fetchImages)
  const [volumes, volumesCtl] = createResource(() => (section() === 'volumes' ? 'volumes' : null), fetchVolumes)
  const [networks, networksCtl] = createResource(() => (section() === 'networks' ? 'networks' : null), fetchNetworks)
  const offChanged = wsOnDockerChanged((scopes) => {
    if (scopes.includes('images') && section() === 'images') void imagesCtl.refetch()
    if (scopes.includes('volumes') && section() === 'volumes') void volumesCtl.refetch()
    if (scopes.includes('networks') && section() === 'networks') void networksCtl.refetch()
  })
  onCleanup(offChanged)

  const failing = <T,>(work: Promise<T>): Promise<T | null> => {
    setActionError('')
    return work.catch((e) => {
      setActionError(e instanceof Error ? e.message : 'action failed')
      return null
    })
  }

  const prefs = createQuery(() => prefsOptions(true))
  const dockerPrefs = () => readDockerPrefs(prefs.data)

  // Two-click confirm shared by every destructive row action, keyed by an arbitrary id.
  function confirmedOnce(key: string): boolean {
    if (!dockerPrefs().confirmDestructive) return true
    if (confirmRm() === key) {
      setConfirmRm(null)
      return true
    }
    setConfirmRm(key)
    setTimeout(() => setConfirmRm((v) => (v === key ? null : v)), 3000)
    return false
  }

  async function prune(kind: DockerPruneKind) {
    if (!confirmedOnce(`prune:${kind}`)) return
    setPruneNote('pruning…')
    const result = await failing(dockerPrune(kind))
    setPruneNote(result ? `reclaimed ${result.reclaimed}` : '')
    if (kind === 'images') void imagesCtl.refetch()
    if (kind === 'volumes') void volumesCtl.refetch()
    if (kind === 'networks') void networksCtl.refetch()
    if (kind === 'containers') void refreshDocker()
  }

  async function groupAction(project: string, action: DockerComposeAction) {
    if (action === 'down' && !confirmedOnce(`down:${project}`)) return
    setGroupBusy(project)
    await failing(composeAction(project, action))
    await refreshDocker()
    setGroupBusy(null)
  }

  // Stale stacks: compose projects whose worktree directory is gone.
  const staleProjects = createMemo(() => [...new Set(
    containers().filter((c) => c.workingDirMissing && c.composeProject).map((c) => c.composeProject!),
  )])

  async function cleanUpStale() {
    if (!confirmedOnce('stale-cleanup')) return
    for (const project of staleProjects()) await failing(composeAction(project, 'down'))
    await refreshDocker()
  }

  const filtered = createMemo(() => {
    const q = filter().trim().toLowerCase()
    if (!q) return containers()
    return containers().filter((c) =>
      c.name.toLowerCase().includes(q) || c.image.toLowerCase().includes(q) || (c.composeProject ?? '').toLowerCase().includes(q))
  })
  const groups = createMemo(() => groupContainers(filtered()))
  const activeGroups = () => groups().filter((g) => g.running > 0)
  const stoppedGroups = () => groups().filter((g) => g.running === 0)
  const runningCount = () => containers().filter((c) => c.state === 'running').length
  const unavailableReason = () => {
    const info = dockerInfo()
    return info && !info.available ? info.reason : null
  }

  function toggleGroup(project: string) {
    const next = new Set(collapsed())
    next.has(project) ? next.delete(project) : next.add(project)
    setCollapsed(next)
  }

  async function rowAction(c: DockerContainerSummary, kind: 'toggle' | 'remove') {
    if (kind === 'remove' && !confirmedOnce(c.id)) return
    setRowBusy(c.id)
    if (kind === 'toggle') await failing(containerAction(c.id, isActive(c) ? 'stop' : 'start'))
    else {
      const ok = await failing(removeContainer(c.id, isActive(c)))
      if (ok && selected() === c.id) setSelected(null)
    }
    await refreshDocker()
    setRowBusy(null)
  }

  const row = (c: DockerContainerSummary, inGroup: boolean) => (
    <div
      class="docker-row"
      classList={{ active: selected() === c.id, 'docker-row-nested': inGroup }}
      role="button"
      tabindex="0"
      onClick={() => setSelected(c.id)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
        e.preventDefault()
        setSelected(c.id)
      }}
    >
      <span class="docker-dot" data-state={c.state} />
      <span class="docker-row-name" title={c.name}>{inGroup ? (c.composeService ?? c.name) : c.name}</span>
      <span class="docker-row-meta muted">{c.status}</span>
      <span class="docker-row-actions">
        <button
          type="button"
          title={isActive(c) ? 'Stop' : 'Start'}
          disabled={rowBusy() === c.id}
          onClick={(e) => {
            e.stopPropagation()
            void rowAction(c, 'toggle')
          }}
        >
          {isActive(c) ? '◼' : '▶'}
        </button>
        <button
          type="button"
          class="docker-danger"
          title="Remove container"
          disabled={rowBusy() === c.id}
          onClick={(e) => {
            e.stopPropagation()
            void rowAction(c, 'remove')
          }}
        >
          {confirmRm() === c.id ? '?' : '🗑'}
        </button>
      </span>
    </div>
  )

  const groupBlock = (g: Group) => (
    <Show when={g.project} fallback={row(g.containers[0], false)}>
      <div class="docker-group">
        <div
          class="docker-group-header"
          role="button"
          tabindex="0"
          onClick={() => toggleGroup(g.project!)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
            e.preventDefault()
            toggleGroup(g.project!)
          }}
        >
          <span class="docker-group-chevron">{collapsed().has(g.project!) ? '▸' : '▾'}</span>
          <span class="docker-row-name" title={g.project!}>{g.project}</span>
          <Show when={g.containers.some((c) => c.workingDirMissing)}>
            <span class="docker-stale-chip" title="The compose working directory no longer exists">stale</span>
          </Show>
          <span class="docker-row-meta muted">{g.running}/{g.containers.length} running</span>
          <span class="docker-row-actions">
            <button
              type="button"
              title={g.running > 0 ? 'Stop project' : 'Start project'}
              disabled={groupBusy() === g.project}
              onClick={(e) => {
                e.stopPropagation()
                void groupAction(g.project!, g.running > 0 ? 'stop' : 'start')
              }}
            >
              {g.running > 0 ? '◼' : '▶'}
            </button>
            <button
              type="button"
              class="docker-danger"
              title="Compose down (remove the project's containers and networks; volumes kept)"
              disabled={groupBusy() === g.project}
              onClick={(e) => {
                e.stopPropagation()
                void groupAction(g.project!, 'down')
              }}
            >
              {confirmRm() === `down:${g.project}` ? '?' : '🗑'}
            </button>
          </span>
        </div>
        <Show when={!collapsed().has(g.project!)}>
          <For each={g.containers}>{(c) => row(c, true)}</For>
        </Show>
      </div>
    </Show>
  )

  return (
    <main class="panes docker-browse-panes">
      <section class="pane pane-left docker-browse">
        <div class="section-header">
          Docker{dockerInfo()?.available ? ` · ${runningCount()} running` : ''}
          <button type="button" class="section-refresh" style={{ 'margin-left': 'auto' }} title="Refresh" aria-label="Refresh" disabled={loading()} onClick={() => void refreshDocker()}>
            {loading() ? '...' : '↻'}
          </button>
        </div>
        <Show when={loadError()}><div class="action-error" role="alert">{loadError()}</div></Show>

        <Show
          when={dockerInfo()?.available !== false}
          fallback={
            <div class="workspace-empty-inner">
              <p class="muted">
                {unavailableReason() === 'not_installed'
                  ? 'The docker CLI was not found on PATH.'
                  : 'The docker daemon is not reachable — is Docker/OrbStack running?'}
              </p>
              <button type="button" class="overlay-btn" onClick={() => void refreshDocker()}>Try again</button>
            </div>
          }
        >
          <nav class="docker-tabs docker-subnav">
            <For each={SECTIONS}>
              {(s) => <button type="button" classList={{ active: section() === s.id }} onClick={() => setSection(s.id)}>{s.label}</button>}
            </For>
          </nav>
          <Show when={actionError()}><div class="action-error" role="alert">{actionError()}</div></Show>

          <Show when={section() === 'containers'}>
            <div class="docker-filters">
              <input class="docker-search" type="text" placeholder="Filter name / image / project" value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
            </div>
            <Show when={staleProjects().length}>
              <div class="docker-stale-banner">
                <span>{staleProjects().length} stale project{staleProjects().length === 1 ? '' : 's'} — worktree gone.</span>
                <button type="button" class="overlay-btn" onClick={() => void cleanUpStale()}>
                  {confirmRm() === 'stale-cleanup' ? 'Sure? Composes down all stale' : 'Clean up'}
                </button>
              </div>
            </Show>
            <div class="docker-list">
              <Show when={containers().length} fallback={<p class="placeholder">{loading() ? 'Loading…' : 'No containers.'}</p>}>
                <For each={activeGroups()}>{groupBlock}</For>
                <Show when={dockerPrefs().showStopped && stoppedGroups().length}>
                  <div class="docker-section-label muted">Stopped</div>
                  <For each={stoppedGroups()}>{groupBlock}</For>
                </Show>
              </Show>
            </div>
          </Show>

          <Show when={section() === 'images'}>
            <div class="docker-filters docker-object-bar">
              <span class="muted">{(images() ?? []).length} images</span>
              <button type="button" class="new-pr-btn" onClick={() => void prune('images')}>{confirmRm() === 'prune:images' ? 'Sure?' : 'Prune dangling'}</button>
              <Show when={pruneNote()}><span class="muted" role="status">{pruneNote()}</span></Show>
            </div>
            <div class="docker-list">
              <For each={images() ?? []} fallback={<p class="placeholder">{images.loading ? 'Loading…' : 'No images.'}</p>}>
                {(img) => (
                  <div class="docker-row docker-object-row">
                    <span class="docker-row-name" title={`${img.repository}:${img.tag}`}>{img.repository}<span class="muted">:{img.tag}</span></span>
                    <span class="docker-row-meta muted">{img.size}{img.containers ? ` · in use (${img.containers})` : ''}</span>
                    <span class="docker-row-actions">
                      <button type="button" class="docker-danger" title="Remove image" onClick={() => {
                        if (!confirmedOnce(`img:${img.id}`)) return
                        void failing(removeImage(img.id, false)).then(() => imagesCtl.refetch())
                      }}>{confirmRm() === `img:${img.id}` ? '?' : '🗑'}</button>
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <Show when={section() === 'volumes'}>
            <div class="docker-filters docker-object-bar">
              <span class="muted">{(volumes() ?? []).length} volumes</span>
              <button type="button" class="new-pr-btn" onClick={() => void prune('volumes')}>{confirmRm() === 'prune:volumes' ? 'Sure? Deletes unused data' : 'Prune unused'}</button>
              <Show when={pruneNote()}><span class="muted" role="status">{pruneNote()}</span></Show>
            </div>
            <div class="docker-list">
              <For each={volumes() ?? []} fallback={<p class="placeholder">{volumes.loading ? 'Loading…' : 'No volumes.'}</p>}>
                {(v) => (
                  <div class="docker-row docker-object-row">
                    <span class="docker-row-name" title={v.mountpoint}>{v.anonymous ? `${v.name.slice(0, 12)}… (anonymous)` : v.name}</span>
                    <span class="docker-row-meta muted">{v.composeProject ?? v.driver}</span>
                    <span class="docker-row-actions">
                      <button type="button" class="docker-danger" title="Remove volume (deletes its data)" onClick={() => {
                        if (!confirmedOnce(`vol:${v.name}`)) return
                        void failing(removeVolume(v.name, false)).then(() => volumesCtl.refetch())
                      }}>{confirmRm() === `vol:${v.name}` ? '?' : '🗑'}</button>
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <Show when={section() === 'networks'}>
            <div class="docker-filters docker-object-bar">
              <span class="muted">{(networks() ?? []).length} networks</span>
              <button type="button" class="new-pr-btn" onClick={() => void prune('networks')}>{confirmRm() === 'prune:networks' ? 'Sure?' : 'Prune unused'}</button>
            </div>
            <div class="docker-list">
              <For each={networks() ?? []} fallback={<p class="placeholder">{networks.loading ? 'Loading…' : 'No networks.'}</p>}>
                {(n) => (
                  <div class="docker-row docker-object-row">
                    <span class="docker-row-name" title={n.id}>{n.name}</span>
                    <span class="docker-row-meta muted">{n.driver}{n.internal ? ' · internal' : ''}</span>
                    <span class="docker-row-actions">
                      <Show when={!BUILTIN_NETWORKS.has(n.name)}>
                        <button type="button" class="docker-danger" title="Remove network" onClick={() => {
                          if (!confirmedOnce(`net:${n.id}`)) return
                          void failing(removeNetwork(n.id)).then(() => networksCtl.refetch())
                        }}>{confirmRm() === `net:${n.id}` ? '?' : '🗑'}</button>
                      </Show>
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </section>

      <section class="pane pane-right docker-browse-detail">
        <Show
          when={section() === 'containers' && selected()}
          fallback={<div class="pane-empty"><p class="placeholder">{section() === 'containers' ? 'Select a container.' : `Docker ${section()}.`}</p></div>}
        >
          {(id) => <ContainerDetail target={id()} onRemoved={() => setSelected(null)} />}
        </Show>
      </section>
    </main>
  )
}
