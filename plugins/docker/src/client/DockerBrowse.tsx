// The Docker rail Source (docs/plugins.md): OrbStack-style master/detail. Left column groups
// containers by compose project (running groups first, a Stopped section below) with a segmented
// sub-nav for Images / Volumes / Networks; the right pane is the shared ContainerDetail. Refresh
// is event-driven — the store re-fetches on `docker:changed`.
import { createQuery } from '@tanstack/solid-query'
import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { prefsOptions } from '@acorn/plugin-api/client'
import { wsOnDockerChanged } from './wsChannel'
import { readDockerPrefs } from './dockerPrefs'
import type { DockerComposeAction, DockerContainerSummary, DockerPruneKind } from '../shared/model'
import { composeAction, containerAction, dockerPrune, fetchImages, fetchNetworks, fetchVolumes, removeContainer, removeImage, removeNetwork, removeVolume } from './dockerClient'
import { containers, dockerInfo, loadError, loading, refreshDocker, wireDockerRefresh } from './dockerStore'
import ContainerDetail from './ContainerDetail'
import './docker.css'
import { Alert, Button, EmptyState, Input, Row, SectionHeader, StatusDot, Tabs, Toolbar, TreeRow, createArmedConfirm } from '@acorn/plugin-api/ui'
import { containerTone } from './dockerViewState'

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

  // Two-click confirm shared by every destructive row action, keyed by an arbitrary id. The arming,
  // keying and auto-reset are the shared hook's; the pref gate is docker's own policy.
  const armed = createArmedConfirm()
  const confirmedOnce = (key: string): boolean =>
    !dockerPrefs().confirmDestructive || armed.request(key)

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

  // TreeRow rather than Row: a compose project expands into its containers, so this list is a tree,
  // and the same primitive the API panel's request tree uses gives it the twist, the depth indent and
  // the compact density for free. A standalone container still renders through it, so its label lines
  // up with a project header's rather than sitting a twist-width to the left.
  const row = (c: DockerContainerSummary, inGroup: boolean) => (
    <TreeRow
      class="docker-row"
      depth={inGroup ? 1 : 0}
      reveal
      selected={selected() === c.id}
      onActivate={() => setSelected(c.id)}
      title={c.name}
      leading={<StatusDot tone={containerTone(c.state)} />}
      meta={c.status}
      trailing={
        <>
          <Button
            variant="bare"
            size="sm"
            iconOnly
            title={isActive(c) ? 'Stop' : 'Start'}
            disabled={rowBusy() === c.id}
            onClick={(e) => {
              e.stopPropagation()
              void rowAction(c, 'toggle')
            }}
          >
            {isActive(c) ? '◼' : '▶'}
          </Button>
          <Button
            variant="bare"
            size="sm"
            iconOnly
            tone="danger"
            title="Remove container"
            disabled={rowBusy() === c.id}
            onClick={(e) => {
              e.stopPropagation()
              void rowAction(c, 'remove')
            }}
          >
            {armed.armed() === c.id ? '?' : '🗑'}
          </Button>
        </>
      }
    >
      {inGroup ? (c.composeService ?? c.name) : c.name}
    </TreeRow>
  )

  const groupBlock = (g: Group) => (
    <Show when={g.project} fallback={row(g.containers[0], false)}>
      <div class="docker-group">
        <TreeRow
          class="docker-row"
          expandable
          expanded={!collapsed().has(g.project!)}
          onToggle={() => toggleGroup(g.project!)}
          reveal
          onActivate={() => toggleGroup(g.project!)}
          title={g.project!}
          // The stale chip rides in `meta`, not the body: Row's body ellipsises, so a warning sat
          // after a long project name would be the first thing clipped.
          meta={
            <>
              <Show when={g.containers.some((c) => c.workingDirMissing)}>
                <span class="docker-stale-chip" title="The compose working directory no longer exists">stale</span>
              </Show>
              {g.running}/{g.containers.length} running
            </>
          }
          trailing={
            <>
              <Button
                variant="bare"
                size="sm"
                iconOnly
                title={g.running > 0 ? 'Stop project' : 'Start project'}
                disabled={groupBusy() === g.project}
                onClick={(e) => {
                  e.stopPropagation()
                  void groupAction(g.project!, g.running > 0 ? 'stop' : 'start')
                }}
              >
                {g.running > 0 ? '◼' : '▶'}
              </Button>
              <Button
                variant="bare"
                size="sm"
                iconOnly
                tone="danger"
                title="Compose down (remove the project's containers and networks; volumes kept)"
                disabled={groupBusy() === g.project}
                onClick={(e) => {
                  e.stopPropagation()
                  void groupAction(g.project!, 'down')
                }}
              >
                {armed.armed() === `down:${g.project}` ? '?' : '🗑'}
              </Button>
            </>
          }
        >
          {g.project}
          <Show when={g.containers.some((c) => c.workingDirMissing)}>
            <span class="docker-stale-chip" title="The compose working directory no longer exists">stale</span>
          </Show>
        </TreeRow>
        <Show when={!collapsed().has(g.project!)}>
          <For each={g.containers}>{(c) => row(c, true)}</For>
        </Show>
      </div>
    </Show>
  )

  return (
    <main class="panes">
      <section class="pane pane-left docker-browse">
        <SectionHeader
          actions={
            <Button variant="bare" iconOnly title="Refresh" aria-label="Refresh" busy={loading()} onClick={() => void refreshDocker()}>↻</Button>
          }
        >
          Docker{dockerInfo()?.available ? ` · ${runningCount()} running` : ''}
        </SectionHeader>
        <Show when={loadError()}><Alert>{loadError()}</Alert></Show>

        <Show
          when={dockerInfo()?.available !== false}
          fallback={
            <EmptyState
              title="Docker is unavailable"
              action={<Button onClick={() => void refreshDocker()}>Try again</Button>}
            >
              {unavailableReason() === 'not_installed'
                ? 'The docker CLI was not found on PATH.'
                : 'The docker daemon is not reachable — is Docker/OrbStack running?'}
            </EmptyState>
          }
        >
          <Tabs
            class="docker-subnav"
            tabs={SECTIONS}
            active={section()}
            onChange={(id) => setSection(id as Section)}
            idPrefix="docker-section"
            ariaLabel="Docker objects"
          />
          <Show when={actionError()}><Alert>{actionError()}</Alert></Show>

          <Show when={section() === 'containers'}>
            <Toolbar class="docker-filters" size="sm" ariaLabel="Filter containers">
              <Input class="docker-search" kind="filter" type="text" placeholder="Filter name / image / project" value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
            </Toolbar>
            <Show when={staleProjects().length}>
              <Alert
                tone="warn"
                variant="banner"
                class="docker-stale-banner"
                actions={
                  <Button onClick={() => void cleanUpStale()}>
                    {armed.armed() === 'stale-cleanup' ? 'Sure? Composes down all stale' : 'Clean up'}
                  </Button>
                }
              >
                {staleProjects().length} stale project{staleProjects().length === 1 ? '' : 's'} — worktree gone.
              </Alert>
            </Show>
            <div class="docker-list">
              <Show when={containers().length} fallback={<EmptyState align="start" busy={loading()}>{loading() ? 'Loading…' : 'No containers.'}</EmptyState>}>
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
              <Button onClick={() => void prune('images')}>{armed.armed() === 'prune:images' ? 'Sure?' : 'Prune dangling'}</Button>
              <Show when={pruneNote()}><span class="muted" role="status">{pruneNote()}</span></Show>
            </div>
            <div class="docker-list">
              <For each={images() ?? []} fallback={<EmptyState align="start" busy={images.loading}>{images.loading ? 'Loading…' : 'No images.'}</EmptyState>}>
                {(img) => (
                  <Row
                    class="docker-row"
                    density="compact"
                    reveal
                    title={`${img.repository}:${img.tag}`}
                    meta={`${img.size}${img.containers ? ` · in use (${img.containers})` : ''}`}
                    trailing={
                      <Button variant="bare" size="sm" iconOnly tone="danger" title="Remove image" onClick={() => {
                        if (!confirmedOnce(`img:${img.id}`)) return
                        void failing(removeImage(img.id, false)).then(() => imagesCtl.refetch())
                      }}>{armed.armed() === `img:${img.id}` ? '?' : '🗑'}</Button>
                    }
                  >
                    {img.repository}<span class="muted">:{img.tag}</span>
                  </Row>
                )}
              </For>
            </div>
          </Show>

          <Show when={section() === 'volumes'}>
            <div class="docker-filters docker-object-bar">
              <span class="muted">{(volumes() ?? []).length} volumes</span>
              <Button onClick={() => void prune('volumes')}>{armed.armed() === 'prune:volumes' ? 'Sure? Deletes unused data' : 'Prune unused'}</Button>
              <Show when={pruneNote()}><span class="muted" role="status">{pruneNote()}</span></Show>
            </div>
            <div class="docker-list">
              <For each={volumes() ?? []} fallback={<EmptyState align="start" busy={volumes.loading}>{volumes.loading ? 'Loading…' : 'No volumes.'}</EmptyState>}>
                {(v) => (
                  <Row
                    class="docker-row"
                    density="compact"
                    reveal
                    title={v.mountpoint}
                    meta={v.composeProject ?? v.driver}
                    trailing={
                      <Button variant="bare" size="sm" iconOnly tone="danger" title="Remove volume (deletes its data)" onClick={() => {
                        if (!confirmedOnce(`vol:${v.name}`)) return
                        void failing(removeVolume(v.name, false)).then(() => volumesCtl.refetch())
                      }}>{armed.armed() === `vol:${v.name}` ? '?' : '🗑'}</Button>
                    }
                  >
                    {v.anonymous ? `${v.name.slice(0, 12)}… (anonymous)` : v.name}
                  </Row>
                )}
              </For>
            </div>
          </Show>

          <Show when={section() === 'networks'}>
            <div class="docker-filters docker-object-bar">
              <span class="muted">{(networks() ?? []).length} networks</span>
              <Button onClick={() => void prune('networks')}>{armed.armed() === 'prune:networks' ? 'Sure?' : 'Prune unused'}</Button>
            </div>
            <div class="docker-list">
              <For each={networks() ?? []} fallback={<EmptyState align="start" busy={networks.loading}>{networks.loading ? 'Loading…' : 'No networks.'}</EmptyState>}>
                {(n) => (
                  <Row
                    class="docker-row"
                    density="compact"
                    reveal
                    title={n.id}
                    meta={`${n.driver}${n.internal ? ' · internal' : ''}`}
                    trailing={
                      <Show when={!BUILTIN_NETWORKS.has(n.name)}>
                        <Button variant="bare" size="sm" iconOnly tone="danger" title="Remove network" onClick={() => {
                          if (!confirmedOnce(`net:${n.id}`)) return
                          void failing(removeNetwork(n.id)).then(() => networksCtl.refetch())
                        }}>{armed.armed() === `net:${n.id}` ? '?' : '🗑'}</Button>
                      </Show>
                    }
                  >
                    {n.name}
                  </Row>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </section>

      {/* Spans the shell grid's last two tracks rather than redefining the grid: this Source has two
          columns and the shell has three, and spanning is how github's empty state and the editor
          pane already say that. The left column is then the shell's own, identical to github's, and
          left-collapse keeps working without a rule that has to out-specify each style pack. */}
      <section class="pane pane-right docker-browse-detail" style={{ 'grid-column': '2 / -1' }}>
        <Show
          when={section() === 'containers' && selected()}
          fallback={<div class="pane-empty"><EmptyState align="start">{section() === 'containers' ? 'Select a container.' : `Docker ${section()}.`}</EmptyState></div>}
        >
          {(id) => <ContainerDetail target={id()} onRemoved={() => setSelected(null)} />}
        </Show>
      </section>
    </main>
  )
}
