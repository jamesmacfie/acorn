// The Docker rail Source (docs/docker.md): OrbStack-style master/detail. The left column groups
// containers by compose project (running groups first, a Stopped section below) with a tab strip for
// Images / Volumes / Networks; the right pane is the shared ContainerDetail. Refresh is event-driven:
// the store re-fetches on `docker:changed`.
import { createQuery } from '@tanstack/solid-query'
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { prefsOptions } from '@acorn/plugin-api/client'
import { wsOnDockerChanged } from './wsChannel'
import { readDockerPrefs } from './dockerPrefs'
import type { DockerComposeAction, DockerContainerSummary, DockerPruneKind } from '../shared/model'
import { composeAction, containerAction, dockerPrune, fetchImages, fetchNetworks, fetchVolumes, removeContainer, removeImage, removeNetwork, removeVolume } from './dockerClient'
import { containers, dockerInfo, loadError, loading, refreshDocker, wireDockerRefresh } from './dockerStore'
import ContainerDetail from './ContainerDetail'
import { CONTAINER_POINT } from './extensionPoints'
import {
  Alert, Badge, Button, ConfirmButton, EmptyState, Input, ListColumn, ListDetail, Row, Rows, Section,
  SectionHeader, Stack, StatusDot, TabPanel, Tabs, Text, Toolbar, TreeRow,
} from '@acorn/plugin-api/ui'
import { AnnotationMarks, requestAnnotations } from '@acorn/plugin-api/ui/host'
import { containerTone } from './dockerViewStore'

type SectionId = 'containers' | 'images' | 'volumes' | 'networks'
const SECTIONS: { id: SectionId; label: string }[] = [
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
  const [section, setSection] = createSignal<SectionId>('containers')
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

  async function prune(kind: DockerPruneKind) {
    setPruneNote('pruning…')
    const result = await failing(dockerPrune(kind))
    setPruneNote(result ? `reclaimed ${result.reclaimed}` : '')
    if (kind === 'images') void imagesCtl.refetch()
    if (kind === 'volumes') void volumesCtl.refetch()
    if (kind === 'networks') void networksCtl.refetch()
    if (kind === 'containers') void refreshDocker()
  }

  async function groupAction(project: string, action: DockerComposeAction) {
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

  // Every container on screen, asked about in one request per contributor. The effect re-runs when
  // the list does; `requestAnnotations` compares the key set and does nothing when it has already
  // asked (docs/plugins.md § Cooperative extension points, the `annotation` kind).
  createEffect(() => {
    requestAnnotations(CONTAINER_POINT, filtered().map((c) => ({ container: c.id })))
  })

  function toggleGroup(project: string) {
    const next = new Set(collapsed())
    next.has(project) ? next.delete(project) : next.add(project)
    setCollapsed(next)
  }

  async function rowAction(c: DockerContainerSummary, kind: 'toggle' | 'remove') {
    setRowBusy(c.id)
    if (kind === 'toggle') await failing(containerAction(c.id, isActive(c) ? 'stop' : 'start'))
    else {
      const ok = await failing(removeContainer(c.id, isActive(c)))
      if (ok && selected() === c.id) setSelected(null)
    }
    await refreshDocker()
    setRowBusy(null)
  }

  // Destructive actions arm through `ConfirmButton` unless the reader turned the gate off, so the
  // button is the prompt. The pref is docker's own policy and `skipConfirm` is where it lands.
  const skipConfirm = () => !dockerPrefs().confirmDestructive

  // TreeRow rather than Row: a compose project expands into its containers, so this list is a tree.
  // A standalone container renders through it too, so its label lines up with a project header's
  // rather than sitting a twist-width to the left.
  const row = (c: DockerContainerSummary, inGroup: boolean) => (
    <Stack gap="none">
      <TreeRow
        depth={inGroup ? 1 : 0}
        reveal
        selected={selected() === c.id}
        onPress={() => setSelected(c.id)}
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
              label={isActive(c) ? 'Stop' : 'Start'}
              disabled={rowBusy() === c.id}
              onPress={() => void rowAction(c, 'toggle')}
            >
              {isActive(c) ? '◼' : '▶'}
            </Button>
            <ConfirmButton
              variant="bare"
              size="sm"
              iconOnly
              tone="danger"
              label="Remove container"
              title="Remove container"
              confirmLabel="?"
              skipConfirm={skipConfirm()}
              disabled={rowBusy() === c.id}
              onConfirm={() => void rowAction(c, 'remove')}
            >🗑</ConfirmButton>
          </>
        }
      >
        {inGroup ? (c.composeService ?? c.name) : c.name}
      </TreeRow>
      {/* What other plugins know about this container, drawn by the host under the row it belongs to. */}
      <AnnotationMarks point={CONTAINER_POINT} itemKey={{ container: c.id }} />
    </Stack>
  )

  const groupBlock = (g: Group) => (
    <Show when={g.project} fallback={row(g.containers[0], false)}>
      <Stack gap="none">
        <TreeRow
          expandable
          expanded={!collapsed().has(g.project!)}
          onToggle={() => toggleGroup(g.project!)}
          reveal
          onPress={() => toggleGroup(g.project!)}
          title={g.project!}
          // The stale badge rides in `meta`, not the body: a Row's body ellipsises, so a warning after
          // a long project name is the first thing clipped.
          meta={
            <>
              <Show when={g.containers.some((c) => c.workingDirMissing)}>
                <Badge tone="warn" shape="pill" size="xs">stale</Badge>
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
                label={g.running > 0 ? 'Stop project' : 'Start project'}
                disabled={groupBusy() === g.project}
                onPress={() => void groupAction(g.project!, g.running > 0 ? 'stop' : 'start')}
              >
                {g.running > 0 ? '◼' : '▶'}
              </Button>
              <ConfirmButton
                variant="bare"
                size="sm"
                iconOnly
                tone="danger"
                label="Compose down"
                title="Compose down (remove the project's containers and networks; volumes kept)"
                confirmLabel="?"
                skipConfirm={skipConfirm()}
                disabled={groupBusy() === g.project}
                onConfirm={() => void groupAction(g.project!, 'down')}
              >🗑</ConfirmButton>
            </>
          }
        >
          {g.project}
        </TreeRow>
        <Show when={!collapsed().has(g.project!)}>
          <For each={g.containers}>{(c) => row(c, true)}</For>
        </Show>
      </Stack>
    </Show>
  )

  const ObjectBar = (barProps: { count: number; noun: string; kind: DockerPruneKind; confirmLabel: string; pruneLabel: string }) => (
    <Toolbar size="sm" ariaLabel={`${barProps.noun} actions`}>
      <Text emphasis="muted">{barProps.count} {barProps.noun}</Text>
      <ConfirmButton
        size="sm"
        label={barProps.pruneLabel}
        confirmLabel={barProps.confirmLabel}
        skipConfirm={skipConfirm()}
        onConfirm={() => void prune(barProps.kind)}
      >{barProps.pruneLabel}</ConfirmButton>
      <Show when={pruneNote()}>{(note) => <Text emphasis="muted">{note()}</Text>}</Show>
    </Toolbar>
  )

  const list = (
    <>
      <SectionHeader
        actions={<Button variant="bare" iconOnly title="Refresh" label="Refresh" busy={loading()} onPress={() => void refreshDocker()}>↻</Button>}
      >
        Docker{dockerInfo()?.available ? ` · ${runningCount()} running` : ''}
      </SectionHeader>
      <Show when={loadError()}>{(error) => <Alert>{error()}</Alert>}</Show>

      <Show
        when={dockerInfo()?.available !== false}
        fallback={
          <EmptyState
            title="Docker is unavailable"
            action={<Button onPress={() => void refreshDocker()}>Try again</Button>}
          >
            {unavailableReason() === 'not_installed'
              ? 'The docker CLI was not found on PATH.'
              : 'The docker daemon is not reachable — is Docker/OrbStack running?'}
          </EmptyState>
        }
      >
        <Tabs
          tabs={SECTIONS}
          active={section()}
          onChange={(id) => setSection(id as SectionId)}
          idPrefix="docker-section"
          ariaLabel="Docker objects"
        />
        <Show when={actionError()}>{(error) => <Alert>{error()}</Alert>}</Show>

        <TabPanel id="containers" active={section()} idPrefix="docker-section">
          <Toolbar size="sm" ariaLabel="Filter containers">
            <Input kind="filter" label="Filter containers" placeholder="Filter name / image / project" value={filter()} onInput={(value) => setFilter(value)} />
          </Toolbar>
          <Show when={staleProjects().length}>
            <Alert
              tone="warn"
              variant="banner"
              actions={
                <ConfirmButton
                  label="Clean up"
                  confirmLabel="Sure? Composes down all stale"
                  skipConfirm={skipConfirm()}
                  onConfirm={() => void cleanUpStale()}
                >Clean up</ConfirmButton>
              }
            >
              {staleProjects().length} stale project{staleProjects().length === 1 ? '' : 's'} — worktree gone.
            </Alert>
          </Show>
          <Show when={containers().length} fallback={<EmptyState align="start" busy={loading()}>{loading() ? 'Loading…' : 'No containers.'}</EmptyState>}>
            <Stack gap="none">
              <For each={activeGroups()}>{groupBlock}</For>
              <Show when={dockerPrefs().showStopped && stoppedGroups().length}>
                <Section label="Stopped" count={stoppedGroups().length}>
                  <For each={stoppedGroups()}>{groupBlock}</For>
                </Section>
              </Show>
            </Stack>
          </Show>
        </TabPanel>

        <TabPanel id="images" active={section()} idPrefix="docker-section">
          <ObjectBar count={(images() ?? []).length} noun="images" kind="images" pruneLabel="Prune dangling" confirmLabel="Sure?" />
          <Rows
            id="docker.images"
            ariaLabel="Images"
            items={(images() ?? []).map((img) => ({ key: img.id, label: `${img.repository}:${img.tag}`, img }))}
          >
            {(entry, item) => (
              <Row
                item={item}
                density="compact"
                reveal
                title={`${entry.img.repository}:${entry.img.tag}`}
                meta={`${entry.img.size}${entry.img.containers ? ` · in use (${entry.img.containers})` : ''}`}
                trailing={
                  <ConfirmButton
                    variant="bare"
                    size="sm"
                    iconOnly
                    tone="danger"
                    label="Remove image"
                    title="Remove image"
                    confirmLabel="?"
                    skipConfirm={skipConfirm()}
                    onConfirm={() => void failing(removeImage(entry.img.id, false)).then(() => imagesCtl.refetch())}
                  >🗑</ConfirmButton>
                }
              >
                {entry.img.repository}<Text emphasis="muted">:{entry.img.tag}</Text>
              </Row>
            )}
          </Rows>
          <Show when={!(images() ?? []).length}>
            <EmptyState align="start" busy={images.loading}>{images.loading ? 'Loading…' : 'No images.'}</EmptyState>
          </Show>
        </TabPanel>

        <TabPanel id="volumes" active={section()} idPrefix="docker-section">
          <ObjectBar count={(volumes() ?? []).length} noun="volumes" kind="volumes" pruneLabel="Prune unused" confirmLabel="Sure? Deletes unused data" />
          <Rows
            id="docker.volumes"
            ariaLabel="Volumes"
            items={(volumes() ?? []).map((v) => ({ key: v.name, label: v.name, volume: v }))}
          >
            {(entry, item) => (
              <Row
                item={item}
                density="compact"
                reveal
                title={entry.volume.mountpoint}
                meta={entry.volume.composeProject ?? entry.volume.driver}
                trailing={
                  <ConfirmButton
                    variant="bare"
                    size="sm"
                    iconOnly
                    tone="danger"
                    label="Remove volume"
                    title="Remove volume (deletes its data)"
                    confirmLabel="?"
                    skipConfirm={skipConfirm()}
                    onConfirm={() => void failing(removeVolume(entry.volume.name, false)).then(() => volumesCtl.refetch())}
                  >🗑</ConfirmButton>
                }
              >
                {entry.volume.anonymous ? `${entry.volume.name.slice(0, 12)}… (anonymous)` : entry.volume.name}
              </Row>
            )}
          </Rows>
          <Show when={!(volumes() ?? []).length}>
            <EmptyState align="start" busy={volumes.loading}>{volumes.loading ? 'Loading…' : 'No volumes.'}</EmptyState>
          </Show>
        </TabPanel>

        <TabPanel id="networks" active={section()} idPrefix="docker-section">
          <ObjectBar count={(networks() ?? []).length} noun="networks" kind="networks" pruneLabel="Prune unused" confirmLabel="Sure?" />
          <Rows
            id="docker.networks"
            ariaLabel="Networks"
            items={(networks() ?? []).map((n) => ({ key: n.id, label: n.name, network: n }))}
          >
            {(entry, item) => (
              <Row
                item={item}
                density="compact"
                reveal
                title={entry.network.id}
                meta={`${entry.network.driver}${entry.network.internal ? ' · internal' : ''}`}
                trailing={
                  <Show when={!BUILTIN_NETWORKS.has(entry.network.name)}>
                    <ConfirmButton
                      variant="bare"
                      size="sm"
                      iconOnly
                      tone="danger"
                      label="Remove network"
                      title="Remove network"
                      confirmLabel="?"
                      skipConfirm={skipConfirm()}
                      onConfirm={() => void failing(removeNetwork(entry.network.id)).then(() => networksCtl.refetch())}
                    >🗑</ConfirmButton>
                  </Show>
                }
              >
                {entry.network.name}
              </Row>
            )}
          </Rows>
          <Show when={!(networks() ?? []).length}>
            <EmptyState align="start" busy={networks.loading}>{networks.loading ? 'Loading…' : 'No networks.'}</EmptyState>
          </Show>
        </TabPanel>
      </Show>
    </>
  )

  return (
    <ListDetail listLabel="Docker objects" list={<ListColumn>{list}</ListColumn>}>
      <Show
        when={section() === 'containers' && selected()}
        fallback={<EmptyState align="start">{section() === 'containers' ? 'Select a container.' : `Docker ${section()}.`}</EmptyState>}
      >
        {(id) => <ContainerDetail target={id()} onRemoved={() => setSelected(null)} />}
      </Show>
    </ListDetail>
  )
}
