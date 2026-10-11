import { createEffect, createMemo, createSignal, on, onCleanup, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import {
  activeNodeId,
  createSettingSave,
  latestSignal,
  PrefKeys,
  prefsOptions,
  projectsOptions,
  savePref,
  useUnsavedChanges,
  readJson,
  writeJson,
} from '@acorn/plugin-api/client'
import { Alert, Button, Checkbox, Input, Select, SettingRow, SettingsSection, Stack, Text } from '@acorn/plugin-api/ui'
import { gitSettingsRoute, type GitSettings, type IdentityWriteResult } from '../shared/api'

const key = (projectId: string) => ['git-settings', activeNodeId(), projectId] as const
const options = (projectId: string) => ({
  queryKey: key(projectId),
  queryFn: ({ signal }: { signal: AbortSignal }) => readJson<GitSettings>(gitSettingsRoute(projectId), { signal }),
  enabled: !!projectId,
})
type IdentityDraft = {
  nodeId: string | null
  projectId: string
  scope: 'local' | 'global'
  name: string
  email: string
}

export default function GitSettingsPage() {
  const cache = useQueryClient()
  const projects = createQuery(() => projectsOptions(true))
  const [selectedProject, setSelectedProject] = createSignal('')
  const projectId = () =>
    selectedProject() || projects.data?.find((project) => project.vcs === 'git' && !!project.path)?.id || ''
  const settings = createQuery(() => options(projectId()))
  const [scope, setScope] = createSignal<'local' | 'global'>('local')
  const [draft, setDraft] = createSignal<IdentityDraft | null>(null)
  const [identityError, setIdentityError] = createSignal('')
  const [writing, setWriting] = createSignal(false)
  const identityWrite = latestSignal()
  let draftVersion = 0
  const pullSave = createSettingSave()
  const fetchSave = createSettingSave()
  const stored = createMemo(() => ({
    name: scope() === 'local' ? (settings.data?.name.local ?? '') : (settings.data?.name.global ?? ''),
    email: scope() === 'local' ? (settings.data?.email.local ?? '') : (settings.data?.email.global ?? ''),
  }))
  const form = () => draft() ?? { nodeId: activeNodeId(), projectId: projectId(), scope: scope(), ...stored() }
  const dirty = () =>
    !!draft() &&
    (draft()!.nodeId !== activeNodeId() ||
      draft()!.projectId !== projectId() ||
      draft()!.scope !== scope() ||
      draft()!.name !== stored().name ||
      draft()!.email !== stored().email)
  useUnsavedChanges(dirty)
  const edit = (field: 'name' | 'email', value: string) => {
    draftVersion++
    setDraft({ ...form(), [field]: value })
  }
  const formScope = () => JSON.stringify([activeNodeId(), projectId(), scope()])
  createEffect(
    on(
      formScope,
      () => {
        identityWrite.abort()
        setWriting(false)
      },
      { defer: true },
    ),
  )
  onCleanup(() => identityWrite.abort())
  const save = async () => {
    const value = form()
    if (
      !value.projectId ||
      value.nodeId !== activeNodeId() ||
      value.projectId !== projectId() ||
      value.scope !== scope()
    ) {
      setIdentityError('Node, project, or scope changed. Cancel this draft and reopen Git settings.')
      return
    }
    const queryKey = key(value.projectId),
      submittedScope = formScope(),
      submittedVersion = draftVersion
    const signal = identityWrite.next()
    const current = () => !signal.aborted && submittedScope === formScope()
    setWriting(true)
    setIdentityError('')
    try {
      const result = await writeJson<IdentityWriteResult>(`${gitSettingsRoute(value.projectId)}/identity`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: value.scope, name: value.name, email: value.email }),
      })
      if (result.readbackError) void cache.invalidateQueries({ queryKey })
      else cache.setQueryData(queryKey, result.settings)
      if (current()) {
        if (result.name.ok && result.email.ok && !result.readbackError) {
          if (submittedVersion === draftVersion) setDraft(null)
        } else
          setIdentityError(
            [
              result.name.error && `Name: ${result.name.error}`,
              result.email.error && `Email: ${result.email.error}`,
              result.readbackError,
            ]
              .filter(Boolean)
              .join(' '),
          )
      }
    } catch (error) {
      if (current()) setIdentityError(error instanceof Error ? error.message : String(error))
    } finally {
      if (current()) setWriting(false)
    }
  }
  const preference = async (kind: 'pull-policy' | 'auto-fetch', value: 'ff-only' | 'rebase' | boolean) => {
    const target = projectId(),
      nodeId = activeNodeId()
    const result = await writeJson<GitSettings>(`${gitSettingsRoute(target)}/preference`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, value }),
    })
    if (nodeId === activeNodeId() && target === projectId()) cache.setQueryData(key(target), result)
  }
  return (
    <>
      <SettingsSection id="identity" label="Git identity">
        <SettingRow label="Repository" description="Select a Git project on this Node.">
          <Select
            label="Repository"
            value={projectId()}
            disabled={dirty()}
            options={(projects.data ?? [])
              .filter((project) => project.vcs === 'git' && !!project.path)
              .map((project) => ({ value: project.id, label: project.name }))}
            onChange={(value) => {
              identityWrite.abort()
              draftVersion++
              setDraft(null)
              setSelectedProject(value)
            }}
          />
        </SettingRow>
        <Show when={settings.error}>
          <Alert tone="warn">{String(settings.error)}</Alert>
        </Show>
        <Show when={settings.data}>
          <SettingRow
            label="Write scope"
            description="Local writes this repository; global writes the user account on this Node."
          >
            <Select
              label="Write scope"
              value={scope()}
              disabled={dirty()}
              options={[
                { value: 'local', label: 'Repository local' },
                { value: 'global', label: 'Node user global' },
              ]}
              onChange={(value) => {
                identityWrite.abort()
                draftVersion++
                setDraft(null)
                setScope(value as 'local' | 'global')
              }}
            />
          </SettingRow>
          <SettingRow
            label="Effective author"
            description={`${settings.data?.name.value ?? 'Unset'} · ${settings.data?.name.scope ?? 'unset'} · ${settings.data?.name.origin ?? 'no origin'}`}
          />
          <SettingRow
            label="Effective email"
            description={`${settings.data?.email.value ?? 'Unset'} · ${settings.data?.email.scope ?? 'unset'} · ${settings.data?.email.origin ?? 'no origin'}`}
          />
          <SettingRow label="Author name">
            <Input label="Author name" value={form().name} onInput={(value) => edit('name', value)} />
          </SettingRow>
          <SettingRow label="Author email">
            <Input label="Author email" value={form().email} onInput={(value) => edit('email', value)} />
          </SettingRow>
          <Show when={identityError()}>
            <Alert tone="warn">{identityError()}</Alert>
          </Show>
          <Show when={dirty()}>
            <Stack gap="row">
              <Button busy={writing()} onPress={() => void save()}>
                Save identity
              </Button>
              <Button
                variant="ghost"
                onPress={() => {
                  identityWrite.abort()
                  draftVersion++
                  setWriting(false)
                  setDraft(null)
                  setIdentityError('')
                }}
              >
                Cancel
              </Button>
            </Stack>
          </Show>
        </Show>
      </SettingsSection>
      <SettingsSection id="behavior" label="Git behavior">
        <SettingRow
          label="Pull strategy"
          description="Applies to the default pull action in Changes and Git."
          error={pullSave.error()}
          savedAt={pullSave.savedAt()}
        >
          <Select
            label="Pull strategy"
            value={settings.data?.pullPolicy ?? 'ff-only'}
            options={[
              { value: 'ff-only', label: 'Fast-forward only' },
              { value: 'rebase', label: 'Rebase' },
            ]}
            onChange={(value) => void pullSave.run(() => preference('pull-policy', value as 'ff-only' | 'rebase'))}
          />
        </SettingRow>
        <SettingRow
          label="Auto-fetch"
          description="Off by default. When enabled, this Node fetches once per repository every five minutes."
          error={fetchSave.error()}
          savedAt={fetchSave.savedAt()}
        >
          <Checkbox
            switch
            ariaLabel="Auto-fetch"
            checked={settings.data?.autoFetch ?? false}
            onChange={(value) => fetchSave.run(() => preference('auto-fetch', value))}
          />
        </SettingRow>
      </SettingsSection>
    </>
  )
}

export function GitAppearanceSettings() {
  const cache = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const graph = createSettingSave(),
    diff = createSettingSave()
  return (
    <SettingsSection id="display" label="Git display">
      <SettingRow
        label="History graph"
        scope="device"
        description="Show connected lanes beside commit rows on this device."
        error={graph.error()}
        savedAt={graph.savedAt()}
      >
        <Checkbox
          switch
          ariaLabel="History graph"
          checked={prefs.data?.[PrefKeys.gitGraphVisible] !== 'false'}
          onChange={(value) =>
            graph.run(() => savePref(cache, PrefKeys.gitGraphVisible, String(value), { throwOnFailure: true }))
          }
        />
      </SettingRow>
      <SettingRow
        label="Diff presentation"
        scope="device"
        description="Shared by Git and Changes on this device."
        error={diff.error()}
        savedAt={diff.savedAt()}
      >
        <Select
          label="Diff presentation"
          value={prefs.data?.[PrefKeys.diffView] === 'split' ? 'split' : 'unified'}
          options={[
            { value: 'unified', label: 'Unified' },
            { value: 'split', label: 'Split' },
          ]}
          onChange={(value) => void diff.run(() => savePref(cache, PrefKeys.diffView, value, { throwOnFailure: true }))}
        />
      </SettingRow>
      <Text>The diff viewer also offers this switch while reading a file.</Text>
    </SettingsSection>
  )
}
