import { For, Show, createMemo, createResource, createSignal, onCleanup, onMount, type JSX } from 'solid-js'
import type { BridgeHandoff, BridgeTaskPage } from '@acorn/protocol/extensionBridge.ts'
import { sameSite, siteText, type ProjectSite, type SiteAssociation } from '@acorn/protocol/siteAssociations.ts'
import Icon from '@acorn/client-core/kit/components/content/Icon.tsx'
import { Text } from '@acorn/client-core/kit/components/content'
import { IconButton } from '@acorn/client-core/kit/components/inputs'
import { SettingsSection } from '@acorn/client-core/kit/components/layout'
import { Menu } from '@acorn/client-core/kit/components/overlays'
import { Alert, Button, Checkbox, EmptyState, Row } from '@acorn/client-core/kit/components/primitives.tsx'
import { brandMarkRegistry } from '@acorn/client-core/kit/tokens'
import type { BrowserApi } from '../browser'
import { loadDestination } from '../localState'
import { CallFailure } from '../messages'
import { AddSite } from './AddSite'
import type { BridgeClient } from './bridgeClient'
import { errorGuidance } from './guidance'
import { siteRows, type SiteRow } from './siteRows'

const withoutProject = ({ projectId: _projectId, ...site }: ProjectSite): SiteAssociation => site

// Settings › Sites: each website the extension does something on, with a switch for the browser's
// access to it and, where it suggests a project, a menu that edits or removes that association. The
// switch is access and nothing else: turning it off leaves an association in place.
// docs/browser-extension/project-sites.md.
export function Sites(props: {
  api: BrowserApi
  client: BridgeClient
  nodeId: string | null
  online: boolean
  handoffs: readonly BridgeHandoff[]
  sites: readonly ProjectSite[]
  apps: readonly BridgeTaskPage[]
  pageUrl: string | undefined
  // The Node's list for that project after a change.
  changed(projectId: string, sites: SiteAssociation[]): void
}) {
  // The selected Node's projects, for the names a row says it suggests and for the dialog's picker.
  const [listed] = createResource(
    () => props.nodeId,
    (nodeId) => props.client.call({ op: 'projects.list', nodeId }).catch(() => null),
  )
  const projects = () => listed()?.projects.filter((project) => !project.hidden) ?? []
  // The current task's project, for Add site to start on.
  const [destination] = createResource(
    () => props.nodeId,
    (nodeId) => loadDestination(props.api.storage.local, nodeId),
  )
  const rows = createMemo(() =>
    siteRows({ handoffs: props.handoffs, sites: props.sites, apps: props.apps, projects: projects() }),
  )

  const [dialog, setDialog] = createSignal<{ editing?: ProjectSite } | null>(null)
  const [problem, setProblem] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)
  // Rejects with what to tell the person, for the dialog to show beside the fields.
  const change = async (op: 'site.add' | 'site.remove', projectId: string, site: SiteAssociation) => {
    setBusy(true)
    try {
      const result = await props.client.call({ op, nodeId: props.nodeId!, projectId, site })
      props.changed(result.projectId, result.sites)
    } catch (error) {
      throw new Error(error instanceof CallFailure ? errorGuidance(error) : String(error))
    } finally {
      setBusy(false)
    }
  }
  // An edit adds the new association before it removes the old one, so a refusal loses nothing.
  const save = async (projectId: string, site: SiteAssociation, editing?: ProjectSite) => {
    if (editing && editing.projectId === projectId && sameSite(editing, site)) return
    await change('site.add', projectId, site)
    if (editing) await change('site.remove', editing.projectId, withoutProject(editing))
  }
  const remove = (association: ProjectSite) => {
    setProblem(null)
    change('site.remove', association.projectId, withoutProject(association)).catch((error: Error) =>
      setProblem(error.message),
    )
  }
  const projectName = (projectId: string) => projects().find((project) => project.id === projectId)?.name

  return (
    <SettingsSection
      id="sites"
      label="Sites"
      actions={
        <Button size="sm" variant="ghost" disabled={!props.online || !projects().length} onPress={() => setDialog({})}>
          <Icon name="plus" /> Add site
        </Button>
      }
    >
      <Show when={problem()}>{(message) => <Alert>{message()}</Alert>}</Show>
      <SiteList
        api={props.api}
        rows={rows()}
        menu={(row) => (
          <Show when={row.associations.length}>
            <SiteMenu
              row={row}
              disabled={!props.online || busy()}
              projectName={projectName}
              edit={(editing) => setDialog({ editing })}
              remove={remove}
            />
          </Show>
        )}
      />
      <Show when={dialog()} keyed>
        {(open) => (
          <AddSite
            projects={projects()}
            workspaces={listed()?.workspaces ?? []}
            projectId={destination()?.projectId ?? null}
            editing={open.editing}
            pageUrl={props.pageUrl}
            busy={busy()}
            save={(projectId, site) => save(projectId, site, open.editing)}
            close={() => setDialog(null)}
          />
        )}
      </Show>
    </SettingsSection>
  )
}

// The sites, each with the plugin's logo or a globe, the host and what the extension does there, then
// what `menu` adds and the switch for the browser's access to it. Pairing shows the same list.
export function SiteList(props: { api: BrowserApi; rows: readonly SiteRow[]; menu?: (row: SiteRow) => JSX.Element }) {
  // Which sites the person has granted. Read again after each change, and whenever the list changes.
  const [granted, { refetch }] = createResource(
    () => props.rows.flatMap((row) => (row.pattern ? [row.pattern] : [])),
    async (patterns) =>
      new Map(
        await Promise.all(
          patterns.map(
            async (pattern) => [pattern, await props.api.permissions.contains({ origins: [pattern] })] as const,
          ),
        ),
      ),
  )
  const onAccess = () => void refetch()
  onMount(() => {
    props.api.permissions.onAdded.addListener(onAccess)
    props.api.permissions.onRemoved.addListener(onAccess)
  })
  onCleanup(() => {
    props.api.permissions.onAdded.removeListener(onAccess)
    props.api.permissions.onRemoved.removeListener(onAccess)
  })
  // `request` must run inside the person's click, so nothing is awaited before it. A declined prompt
  // answers false, which puts the switch back.
  const setAccess = (pattern: string, on: boolean) =>
    (on
      ? props.api.permissions.request({ origins: [pattern] })
      : props.api.permissions.remove({ origins: [pattern] })
    ).catch(() => false)
  const plugin = (row: SiteRow) => (row.pluginId && brandMarkRegistry.get(row.pluginId) ? row.pluginId : null)

  return (
    <Show
      when={props.rows.length}
      fallback={
        <EmptyState align="start" size="sm">
          No site needs access yet.
        </EmptyState>
      }
    >
      <For each={props.rows}>
        {(row) => (
          <Row
            variant="stacked"
            leading={
              <Show when={plugin(row)} fallback={<Icon name="globe" tone="muted" />}>
                {(id) => <Icon name={`brand:${id()}`} tone="brand" />}
              </Show>
            }
            trailing={
              <>
                {props.menu?.(row)}
                <Show when={row.pattern}>
                  {(pattern) => (
                    <Checkbox
                      switch
                      ariaLabel={`Access to ${row.host}`}
                      checked={!!granted()?.get(pattern())}
                      onChange={(on) => setAccess(pattern(), on)}
                    />
                  )}
                </Show>
              </>
            }
          >
            <Text>{row.host}</Text>
            <Text emphasis="muted">{row.uses.join(', ')}</Text>
          </Row>
        )}
      </For>
    </Show>
  )
}

// A site's ⋯ menu: each project it suggests, with Edit and Remove.
function SiteMenu(props: {
  row: SiteRow
  disabled: boolean
  projectName(projectId: string): string | undefined
  edit(association: ProjectSite): void
  remove(association: ProjectSite): void
}) {
  return (
    <Menu
      ariaLabel={`${props.row.host} actions`}
      placement="bottom-end"
      trigger={(state) => (
        <IconButton
          icon="ellipsis"
          label="Site actions"
          variant="ghost"
          size="sm"
          opens="menu"
          expanded={state.open()}
          disabled={props.disabled}
          onPress={state.toggle}
        />
      )}
    >
      {(context) => (
        <For each={props.row.associations}>
          {(association) => (
            <>
              <Menu.Label>
                {siteText(association)} · {props.projectName(association.projectId) ?? 'a project'}
              </Menu.Label>
              <Menu.Item context={context} leading={<Icon name="pencil" />} onSelect={() => props.edit(association)}>
                Edit
              </Menu.Item>
              <Menu.Item
                context={context}
                leading={<Icon name="trash-2" />}
                tone="danger"
                onSelect={() => props.remove(association)}
              >
                Remove
              </Menu.Item>
            </>
          )}
        </For>
      )}
    </Menu>
  )
}
