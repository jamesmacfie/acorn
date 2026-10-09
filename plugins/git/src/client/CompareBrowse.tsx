import { createEffect, createSignal, on, Show } from 'solid-js'
import { useMatch, useNavigate, useParams } from '@solidjs/router'
import { createQuery } from '@tanstack/solid-query'
import { activeNodeId, writeJson } from '@acorn/plugin-api/client'
import { Alert, Button, EmptyState, Facts, Input, SectionHeader, Select, Stack, Text } from '@acorn/plugin-api/ui'
import { comparisonRoute, type Comparison, type ComparisonMode } from '../shared/api'
import { refsOptions } from './refsClient'
import { RevisionView } from './RevisionView'

const base = (projectId: string) => `/p/${encodeURIComponent(projectId)}/x/git/compare`
const path = (projectId: string, pinned: Comparison) => `${base(projectId)}/${pinned.source}/${pinned.destination}/${pinned.mode}/${pinned.base}`

export function CompareSourceList() {
  const params = useParams<{ projectId: string }>()
  const pinned = useMatch(() => '/p/:projectId/x/git/compare/:source/:destination/:mode/:base')
  const navigate = useNavigate()
  const refs = createQuery(() => refsOptions(params.projectId))
  const [source, setSource] = createSignal('')
  const [destination, setDestination] = createSignal('')
  const [sourceId, setSourceId] = createSignal('')
  const [destinationId, setDestinationId] = createSignal('')
  const [mode, setMode] = createSignal<ComparisonMode>('direct')
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const choices = () => [{ value: '', label: 'Choose a ref' }, ...(refs.data?.refs.filter((ref) => !!ref.commitId).map((ref) => ({ value: `${ref.kind}:${ref.name}`, label: `${ref.kind} · ${ref.name} · ${ref.commitId!.slice(0, 8)}` })) ?? [])]
  const pin = async () => {
    const nodeId = activeNodeId(), projectId = params.projectId
    setBusy(true); setError('')
    try {
      const result = await writeJson<Comparison>(comparisonRoute(projectId), { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: sourceId().trim() || source(), destination: destinationId().trim() || destination(), mode: mode() }) })
      if (activeNodeId() === nodeId && params.projectId === projectId) navigate(path(projectId, result))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  createEffect(on(activeNodeId, () => { if (pinned()) navigate(base(params.projectId)) }, { defer: true }))
  return <Stack gap="section">
    <SectionHeader>Compare commits</SectionHeader>
    <Text>Choose source → destination. Reversing them reverses additions and deletions.</Text>
    <Select label="Source ref" value={source()} options={choices()} onChange={setSource} />
    <Input label="Source full commit ID (optional)" value={sourceId()} onInput={setSourceId} />
    <Select label="Destination ref" value={destination()} options={choices()} onChange={setDestination} />
    <Input label="Destination full commit ID (optional)" value={destinationId()} onInput={setDestinationId} />
    <Select label="Base mode" value={mode()} options={[{ value: 'direct', label: 'Direct source tree' }, { value: 'merge-base', label: 'Shared merge base' }]} onChange={(value) => setMode(value as ComparisonMode)} />
    <Button busy={busy()} disabled={busy() || !(sourceId().trim() || source()) || !(destinationId().trim() || destination())} onPress={() => void pin()}>Pin comparison</Button>
    <Show when={error()}><Alert tone="warn">{error()}</Alert></Show>
    <Show when={pinned()}>{(match) => <Text emphasis="muted">Pinned {match().params.source?.slice(0, 8)} → {match().params.destination?.slice(0, 8)} · {match().params.mode}</Text>}</Show>
  </Stack>
}

export function CompareSourceDetail() {
  const params = useParams<{ projectId: string }>()
  const pinned = useMatch(() => '/p/:projectId/x/git/compare/:source/:destination/:mode/:base')
  const navigate = useNavigate()
  const valid = () => !!pinned() && /^[0-9a-f]{40,64}$/.test(pinned()!.params.source ?? '') && /^[0-9a-f]{40,64}$/.test(pinned()!.params.destination ?? '')
  return <Show when={valid()} fallback={<EmptyState title="Select two revisions">Pin a source, destination, and comparison mode.</EmptyState>}>
    <Stack gap="section">
      <Facts grouping="rows" items={[{ label: 'Direction', value: `${pinned()!.params.source} → ${pinned()!.params.destination}`, mono: true },
        { label: 'Mode', value: pinned()!.params.mode === 'merge-base' ? 'Shared merge base → destination' : 'Direct source → destination' },
        { label: 'Base', value: pinned()!.params.base, mono: true }]} />
      <RevisionView projectId={params.projectId} id={pinned()!.params.destination ?? null} comparisonBase={pinned()!.params.base ?? ''} explain={false}
        onCommit={(id) => navigate(`/p/${encodeURIComponent(params.projectId)}/x/git/history/${id}`)} />
    </Stack>
  </Show>
}
