import { createEffect, createMemo, createSignal, Index, on, onCleanup, onMount, Show, Suspense, untrack } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { createQuery } from '@tanstack/solid-query'
import { eventChord, isTypingTarget } from '@acorn/protocol/keybindings.ts'
import type { SettingsCategory } from '@acorn/protocol/settingsPages.ts'
import { SETTINGS_CATEGORIES } from '@acorn/protocol/settingsPages.ts'
import { connectionName } from '@acorn/protocol/integrations.ts'
import { integrationsOptions, projectsOptions, workspacesOptions, type Project, type Workspace } from '../../infra/queries'
import { activeNodeId } from '../../infra/node/activeNode'
import { nodes } from '../../infra/node/fleet'
import { nodePlugins } from '../../infra/node/nodePlugins'
import { pluginLabel } from '../../host/plugins/pluginLabel'
import { pluginRosterKnown } from '../../infra/node/hostCapabilities'
import { confirmAction } from '../../host/registries/shell/willPhase'
import { buildSettingsIndex, searchSettings, type SettingsSearchObject, type SettingsSearchResult } from '../../host/registries/shell/settingsSearch'
import {
  isStandaloneSettingsPage, parseSettingsTarget, PROJECT_SETTINGS_PREFIX, projectSettingsTarget, resolveSettingsAlias, SETTINGS_CATEGORY_LABELS,
  settingsCategoryOf, settingsDetailPage, settingsPagesInOrder, settingsRegistry, settingsScopeOf, WORKSPACE_SETTINGS_PREFIX,
  workspaceSettingsTarget, type SettingsContribution, type SettingsNavigate, type SettingsPageContext,
} from '../../host/registries/shell/settings'
import { ContributionBoundary } from '../../kit/components/content/ContributionBoundary'
import { createDismissable } from '../../kit/lib/controls/dismissable'
import { createDomCollection } from '../../kit/keys/collection'
import { restoreFocusOnCleanup } from '../../kit/keys/trap'
import { readLocal, writeLocal } from '../../kit/lib/state/deviceStorage'
import { Badge, Button, EmptyState, Input, Select, StatusDot } from '../../kit/components/primitives'
import { IconButton } from '../../kit/components/inputs/IconButton'
import Icon from '../../kit/components/content/Icon'
import { Text } from '../../kit/components/content/Text'
import { createAttentionInbox } from '../notifications/attentionInbox'
import { createUnsavedChanges, UnsavedChangesContext } from './unsavedChanges'
import { createSettingsDetails, SettingsDetailContext } from './settingsDetail'
import { PluginStrip } from './plugins/PluginStrip'
import { connectionPageOf, openConnectionPage } from './connections/connections'
import './settings.css'

// Settings as a place: a full-window layer with a rail of nine groups on the left and one page on the
// right (docs/frontend.md § Settings).
//
// A layer and not a route. The shell mounts it over the workspace, which stays mounted underneath, so a
// terminal, an agent stream or an editor keeps running and is where the person left it after Escape.
// A route would unmount the task's panes.
//
// Three pieces of state, and all three belong to this device and to this one visit. The page is
// remembered across visits in local storage and never sent to a node. The node the header's switcher
// points at starts on the active node every time settings opens and never moves the app's own active
// node, because switching that remounts the whole shell on another node's cache.

/** What asked for settings. A fresh object per request, so the same deep link twice still navigates. */
export type SettingsRequest = { target?: string }

type Selection = { page: string; section?: string }

// A workspace or a project is not a registered page: it is the one page core draws for every workspace
// or every project, addressed by the thing's id (`workspace/<id>`, `project/<id>`), which is what the
// selection, the remembered page and a deep link all carry.
const LAST_PAGE_KEY = 'acorn.settings.last-page'
/** How long a section someone searched for or linked to stays highlighted. */
const HIGHLIGHT_MS = 3000
/** How long to wait for a page to draw the section it was asked for. A lazy page's chunk, a loaded
 *  plugin's tree or a node read can each come first; a section that never appears is simply not
 *  scrolled to. */
const LANDING_WAIT_MS = 5000

const selectionFrom = (target: string): Selection => {
  const { pageId, sectionId } = parseSettingsTarget(target)
  return sectionId ? { page: pageId, section: sectionId } : { page: pageId }
}
const targetOf = (selection: Selection): string =>
  selection.section ? `${selection.page}#${selection.section}` : selection.page

type Resolved = {
  page: SettingsContribution
  category: SettingsCategory
  name: string
  workspace?: Workspace
  project?: Project
}

/** `depth` 1 is a workspace under Overview and 2 a project under its workspace. A workspace row with
 *  projects carries `expanded`. */
type RailRow = { key: string; label: string; category: SettingsCategory; depth?: 1 | 2; expanded?: boolean; workspaceId?: string }

/** One step of the header's path above the title. `to` names the page it opens, for its tip. */
type Crumb = { label: string; to?: string; run?: () => void }

/** Scroll to the section a search result or a deep link named, inside the page that was drawn for it,
 *  and mark it for a few seconds. The mark is an attribute the kit's stylesheet draws, so it is there
 *  at once with motion reduced, and only its fade out moves. */
function landOnSection(page: () => HTMLElement | undefined, section: string): () => void {
  let stopWatching = () => {}
  let clearMark = () => {}
  const find = () => [...(page()?.querySelectorAll<HTMLElement>('[data-settings-section]') ?? [])]
    .find((element) => element.dataset.settingsSection === section)
  const land = (target: HTMLElement) => {
    stopWatching()
    // A section on a tab that is not showing, as on a project's page: pick its tab first. The kit's tab
    // panels stay in the document while hidden, and each names the tab that shows it.
    const tab = target.closest('[role="tabpanel"][hidden]')?.getAttribute('aria-labelledby')
    if (tab) document.getElementById(tab)?.click()
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    target.scrollIntoView?.({ block: 'start', behavior: reduced ? 'auto' : 'smooth' })
    target.setAttribute('data-highlight', '')
    const timer = setTimeout(() => target.removeAttribute('data-highlight'), HIGHLIGHT_MS)
    clearMark = () => {
      clearTimeout(timer)
      target.removeAttribute('data-highlight')
    }
  }
  const now = find()
  if (now) land(now)
  else {
    const root = page()
    if (root) {
      const observer = new MutationObserver(() => { const found = find(); if (found) land(found) })
      observer.observe(root, { childList: true, subtree: true })
      const timeout = setTimeout(() => observer.disconnect(), LANDING_WAIT_MS)
      stopWatching = () => {
        observer.disconnect()
        clearTimeout(timeout)
      }
    }
  }
  return () => {
    stopWatching()
    clearMark()
  }
}

export default function SettingsView(props: { request: SettingsRequest; onClose: () => void }) {
  const workspaces = createQuery(() => workspacesOptions(true))
  // Read for search only: their names are what someone types to find the page that holds them.
  const projects = createQuery(() => projectsOptions(true))
  const integrations = createQuery(() => integrationsOptions(true))
  const pages = createMemo(() => settingsPagesInOrder())
  const railPages = createMemo(() => pages().filter(isStandaloneSettingsPage))
  // The pages drawn for a workspace row and a project row (settingsDetailPage).
  const workspacePage = createMemo(() => settingsDetailPage(pages(), 'workspace'))
  const projectPage = createMemo(() => settingsDetailPage(pages(), 'project'))

  // A page another one absorbed keeps its id as an alias, so an old deep link or a remembered page lands
  // on the page that holds its rows now, at the section they moved to.
  const resolveAlias = (next: Selection): Selection => {
    const alias = resolveSettingsAlias(pages(), next.page)
    if (!alias) return next
    const section = next.section ?? alias.sectionId
    return section ? { page: alias.pageId, section } : { page: alias.pageId }
  }

  const requested = untrack(() => props.request.target)
  const initial = untrack(() => resolveAlias(selectionFrom(requested ?? readLocal(LAST_PAGE_KEY) ?? '')))
  const [selection, setSelection] = createSignal<Selection>(initial)
  // The section to scroll to and mark, set only when someone asked for one: a search result, a palette
  // row, a deep link. The remembered page carries its section too, but reopening settings there should
  // not flash a highlight nobody asked for.
  const requestedSection = requested ? initial.section : undefined
  const [landing, setLanding] = createSignal<{ section: string } | undefined>(requestedSection ? { section: requestedSection } : undefined)
  const [status, setStatus] = createSignal('')
  const [query, setQuery] = createSignal('')
  // Below about 900 px the rail and the page take turns. Opening settings shows the page; its back
  // link shows the rail. Wider, both are always drawn and this is ignored.
  const [pageOpen, setPageOpen] = createSignal(true)
  const [pickedNode, setPickedNode] = createSignal(untrack(activeNodeId))
  // Falls back to the active node when the picked one is unpaired while settings is open.
  const switchedNode = () => {
    const picked = pickedNode()
    return picked && nodes().some((node) => node.nodeId === picked) ? picked : activeNodeId()
  }

  const workspaceById = (id: string) => workspaces.data?.find((workspace) => workspace.id === id)

  const current = createMemo((): Resolved | undefined => {
    const selected = selection().page
    if (selected.startsWith(WORKSPACE_SETTINGS_PREFIX)) {
      const page = workspacePage()
      const workspace = workspaceById(selected.slice(WORKSPACE_SETTINGS_PREFIX.length))
      return page && workspace ? { page, category: 'workspaces', name: workspace.name, workspace } : undefined
    }
    if (selected.startsWith(PROJECT_SETTINGS_PREFIX)) {
      const page = projectPage()
      const project = projects.data?.find((candidate) => candidate.id === selected.slice(PROJECT_SETTINGS_PREFIX.length))
      const workspace = project && workspaceById(project.workspaceId)
      return page && project ? { page, category: 'workspaces', name: project.name, project, ...(workspace ? { workspace } : {}) } : undefined
    }
    const page = railPages().find((candidate) => candidate.id === selected)
    return page ? { page, category: settingsCategoryOf(page), name: page.title ?? page.label } : undefined
  })

  // A page that no longer passes its `requires` gate, or a remembered one a plugin took away, falls back
  // to the first page and says so. A workspace or project row waits for the node's lists before deciding,
  // and every page waits for the node's plugin roster: until it arrives a plugin's page is merely unknown,
  // and giving up on it would also overwrite the remembered page.
  createEffect(() => {
    const selected = selection()
    if (current()) return
    const first = railPages()[0]
    if (!first || !pluginRosterKnown()) return
    if (selected.page.startsWith(WORKSPACE_SETTINGS_PREFIX) && workspaces.isLoading) return
    if (selected.page.startsWith(PROJECT_SETTINGS_PREFIX) && (projects.isLoading || workspaces.isLoading)) return
    setSelection({ page: first.id })
    if (selected.page) setStatus("This page isn't available any more.")
  })
  createEffect(() => {
    if (current()) writeLocal(LAST_PAGE_KEY, targetOf(selection()))
  })

  // Every way off a page comes through here: another page, Back to acorn, Escape, the palette and a
  // deep link. A form holding unsaved changes asks its question in this one place rather than in each
  // of them (./unsavedChanges.ts).
  const unsaved = createUnsavedChanges()
  const leave = (then: () => void) => {
    // A text field saves on blur, and a field removed from the document never blurs. Blurring it first
    // commits what was typed, so closing settings from the keyboard does not drop the last edit. Only a
    // page's own field, not the rail's search, and the layer takes the focus it had, because a blur
    // leaves it on the body, where Escape and ⌘[ reach nothing.
    const focused = document.activeElement
    if (focused instanceof HTMLElement && pageElement?.contains(focused) && focused.matches('input, textarea')) {
      focused.blur()
      root.focus({ preventScroll: true })
    }
    if (!unsaved.dirty()) return then()
    void confirmAction({
      title: 'Discard unsaved changes',
      actionLabel: 'Discard changes',
      goes: "Your changes on this page aren't saved.",
      stays: 'Everything already saved stays as it is.',
      danger: true,
    }).then((discard) => { if (discard) then() })
  }
  // The page a detail page was opened from, so going back from a project returns to Overview when that
  // is where the person came from, rather than always to the project's workspace.
  const [cameFrom, setCameFrom] = createSignal<string>()
  // Counts arrivals, so going to the page already on screen draws it afresh: its rail row, clicked from
  // one of its items, goes back to the list, as every other way onto a page does.
  const [visit, setVisit] = createSignal(0)
  const go = (asked: Selection, opened?: () => void) => leave(() => {
    const next = resolveAlias(asked)
    setStatus('')
    setCameFrom(selection().page)
    setSelection(next)
    setVisit((count) => count + 1)
    setLanding(next.section ? { section: next.section } : undefined)
    setPageOpen(true)
    opened?.()
  })
  const close = () => leave(() => props.onClose())

  // A request that arrives while settings is open: a palette row, or a deep link from under the layer.
  createEffect(on(() => props.request, (request) => { if (request.target) go(selectionFrom(request.target)) }, { defer: true }))

  // A dot for whatever waits on the person. Any attention row that lands on a settings page marks that
  // page: a plugin that failed to start or waits for a decision, a loaded plugin's own rows when it has
  // no rail source of its own, and a connection whose credential was refused (docs/notifications.md
  // § What a row points at).
  const inbox = createAttentionInbox()
  const waiting = (key: string): boolean =>
    inbox().rows.some((row) => row.item.target.kind === 'settings' && parseSettingsTarget(row.item.target.resourceId).pageId === key)

  // Which workspaces show their projects in the rail. Only while expanded, so a node with thirty
  // projects is still a short rail (the brief's open decision 2). Opening a workspace's page or one of
  // its projects expands it; the row's chevron and the arrow keys expand and collapse it.
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set())
  const setOpen = (workspaceId: string, open: boolean) => setExpanded((set) => {
    if (set.has(workspaceId) === open) return set
    const next = new Set(set)
    if (open) next.add(workspaceId)
    else next.delete(workspaceId)
    return next
  })
  createEffect(on(() => current()?.workspace?.id, (workspaceId) => { if (workspaceId) setOpen(workspaceId, true) }))

  const rows = createMemo((): RailRow[] => railPages().flatMap((page) => {
    const category = settingsCategoryOf(page)
    const row: RailRow = { key: page.id, label: page.label, category }
    // Workspaces follow Overview, the one page core files ahead of them, and each open workspace is
    // followed by its projects.
    if (category !== 'workspaces' || !workspacePage()) return [row]
    return [row, ...(workspaces.data ?? []).flatMap((workspace): RailRow[] => {
      const members = projectPage() ? (projects.data ?? []).filter((project) => project.workspaceId === workspace.id) : []
      const open = members.length > 0 && expanded().has(workspace.id)
      return [
        {
          key: workspaceSettingsTarget(workspace.id), label: workspace.name, category, depth: 1, workspaceId: workspace.id,
          ...(members.length ? { expanded: open } : {}),
        },
        ...(open ? members.map((project): RailRow => ({ key: projectSettingsTarget(project.id), label: project.name, category, depth: 2 })) : []),
      ]
    })]
  }))
  // Search reads declarations only (../../host/registries/shell/settingsSearch.ts), plus the names of the
  // things settings holds a page for. Each name lands on the page that holds it today.
  const searchObjects = createMemo((): SettingsSearchObject[] => {
    const pageFor = (id: string) => railPages().find((page) => page.id === id)
    const on = (id: string, names: readonly (string | { name: string; keywords: readonly string[] })[]): SettingsSearchObject[] => {
      const page = pageFor(id)
      if (!page) return []
      const at = { page: id, pageLabel: page.title ?? page.label, group: SETTINGS_CATEGORY_LABELS[settingsCategoryOf(page)], scope: settingsScopeOf(page) }
      return names.map((name) => ({ ...at, ...(typeof name === 'string' ? { name } : name) }))
    }
    const group = SETTINGS_CATEGORY_LABELS.workspaces
    // Every workspace and every project is a page of its own, whether or not the rail has it expanded,
    // so search finds a project's name and its sections inside a collapsed workspace too.
    return [
      ...(workspacePage() ? (workspaces.data ?? []) : []).map((workspace): SettingsSearchObject => ({
        name: workspace.name, page: workspaceSettingsTarget(workspace.id), pageLabel: workspace.name,
        group, scope: 'workspace', isPage: true, sections: workspacePage()?.sections ?? [],
      })),
      ...(projectPage() ? (projects.data ?? []) : []).map((project): SettingsSearchObject => ({
        name: project.name, page: projectSettingsTarget(project.id), pageLabel: project.name,
        group, scope: 'project', isPage: true, sections: projectPage()?.sections ?? [],
      })),
      // A connection's name opens its own page, on Services or AI models, whichever lists it.
      ...(integrations.data?.integrations ?? []).flatMap((connection) => {
        const provider = integrations.data?.providers.find((candidate) => candidate.id === connection.providerId)
        return on(connectionPageOf(provider), [connectionName(connection)])
          .map((object) => ({ ...object, open: (navigate: SettingsNavigate) => openConnectionPage(navigate, connection, provider) }))
      }),
      ...on('nodes', nodes().map((node) => node.label)),
      // A plugin shows its name, and its id still finds it: "http" lands on API requests.
      ...on('plugins', (nodePlugins()?.plugins ?? []).map((plugin) => ({ name: pluginLabel(plugin), keywords: [plugin.name] }))),
    ]
  })
  const index = createMemo(() => buildSettingsIndex(railPages(), searchObjects()))
  // A section named like its page reads as the page, so the page's own result would be a second line
  // with the same words. The section's lands deeper, so it is the one kept.
  const matches = createMemo(() => {
    const found = searchSettings(index(), query())
    const echoed = new Set(found.filter((result) => result.section && result.sectionLabel === result.pageLabel).map((result) => result.page))
    return found.filter((result) => result.section || result.sectionLabel || !echoed.has(result.page))
  })
  const groups = createMemo(() =>
    SETTINGS_CATEGORIES.map((category) => ({ category, rows: rows().filter((row) => row.category === category) }))
      .filter((group) => group.rows.length))

  const openResult = (result: SettingsSearchResult) => {
    if (result.open) return result.open(context.navigate)
    go(result.section ? { page: result.page, section: result.section } : { page: result.page })
  }

  const nodeLabel = (nodeId: string | null): string =>
    (nodeId && nodes().find((node) => node.nodeId === nodeId)?.label) || nodeId || 'this node'

  // The node a page's body reads. The switcher's on a page that follows it, and the active node on every
  // other one, because a body bound to the ambient API client can read nothing else.
  const pageNode = () => (current()?.page.followsNodeSwitcher ? switchedNode() : activeNodeId())

  const context: SettingsPageContext = {
    get scope() {
      const workspace = current()?.workspace
      const project = current()?.project
      return { nodeId: pageNode(), ...(workspace ? { workspace } : {}), ...(project ? { project } : {}) }
    },
    navigate: (target, opened) => go(selectionFrom(target), opened),
    get workspace() {
      return current()?.workspace
    },
    onWorkspaceDeleted: () => {
      const overview = overviewPage() ?? railPages()[0]
      if (overview) go({ page: overview.id })
    },
  }

  // A page's own detail, such as one custom agent open from the list (./settingsDetail.ts). The header
  // names it and goes back to the page's list.
  const details = createSettingsDetails()
  const detail = () => (current() ? details.current() : undefined)

  // Where a detail page's back link and ⌘[ go: an item back to its page's list, a workspace back to
  // Overview, and a project back to Overview when it was opened from there, otherwise to its
  // workspace. The list, never the history, so the link always says where it goes.
  const overviewPage = () => railPages().find((page) => settingsCategoryOf(page) === 'workspaces')
  const back = createMemo((): { label: string; run: () => void } | undefined => {
    const resolved = current()
    if (!resolved) return undefined
    const open = detail()
    if (open) return { label: open.backLabel?.() ?? resolved.name, run: () => leave(open.back) }
    const overview = overviewPage()
    if (!resolved.project && !resolved.workspace) return undefined
    const toOverview = overview ? { label: overview.label, run: () => go({ page: overview.id }) } : undefined
    if (!resolved.project) return toOverview
    if (cameFrom() === overview?.id || !resolved.workspace) return toOverview
    const workspace = resolved.workspace
    return { label: workspace.name, run: () => go({ page: workspaceSettingsTarget(workspace.id) }) }
  })
  const goBack = () => back()?.run()

  // The path above the title: the page's group, then whatever the page sits under. The title is the
  // last step, so it is not repeated here. A step that is a page of its own opens it, and the one ⌘[
  // goes to says so in its tip.
  const crumbs = createMemo((): Crumb[] => {
    const resolved = current()
    if (!resolved) return []
    const overview = overviewPage()
    const group: Crumb = { label: SETTINGS_CATEGORY_LABELS[resolved.category] }
    if (overview && (resolved.workspace || resolved.project)) Object.assign(group, { to: overview.label, run: () => go({ page: overview.id }) })
    const steps = [group]
    const workspace = resolved.workspace
    if (resolved.project && workspace) {
      steps.push({ label: workspace.name, to: workspace.name, run: () => go({ page: workspaceSettingsTarget(workspace.id) }) })
    }
    const open = detail()
    if (open) steps.push({ label: resolved.name, to: open.backLabel?.() ?? resolved.name, run: () => leave(open.back) })
    return steps
  })

  // The plugin that contributed the page on screen, if one did. Its strip is drawn by this view, above
  // and outside the box the page's own content sits in (./plugins/PluginStrip.tsx).
  const pluginOwner = () => {
    const page = current()?.page
    return page ? settingsRegistry.ownerOf(page.id) : undefined
  }

  let root!: HTMLDivElement
  let search: HTMLInputElement | undefined
  let pageElement: HTMLDivElement | undefined
  // After the page element exists, which is after `current()` resolves: a workspace row waits for the
  // node's list, and the page body waits for its chunk.
  const drawn = createMemo(() => !!current())
  // What the page body is drawn for. A new workspace, project or node, or a fresh arrival on the same
  // page, remounts the page, so no draft, error, tab or open editor carries over from the last one; a
  // refetch that hands back new objects does not.
  const pageKey = createMemo(() => {
    const resolved = current()
    return resolved ? `${resolved.page.id} ${selection().page} ${visit()} ${pageNode()}` : undefined
  })
  createEffect(() => {
    const target = landing()
    if (!target || !drawn()) return
    onCleanup(landOnSection(() => pageElement, target.section))
  })
  const dismiss = createDismissable({ onDismiss: close, container: () => root, on: ['escape'] })
  const collection = createDomCollection({ selector: '.settings-rail-item' })
  // Focus comes back to wherever it was, a terminal included, when settings closes. Read before
  // anything inside is focused.
  restoreFocusOnCleanup()
  // Into the rail, on the open page's row, so the arrows, Tab and `/` work at once and nothing typed
  // reaches the pane that had focus. After mount, because the layer is not in the document before.
  const railStop = () => root.querySelector<HTMLElement>('.settings-rail-item[aria-current="page"]') ?? search
  onMount(() => railStop()?.focus())

  // Focus that lands under the layer comes back to where it last was inside it. The palette hands focus
  // back to whatever it was opened from when it closes, a terminal included, and a pane can focus its
  // own field on an event. Either would put what the person types somewhere they cannot see. A dialog or
  // a popover drawn above the layer, the palette among them, keeps the focus it takes.
  let lastInside: HTMLElement | undefined
  const onFocusIn = (event: FocusEvent) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (root.contains(target)) {
      lastInside = target
      return
    }
    if (target.closest('[aria-modal="true"], .ui-popover')) return
    ;(lastInside?.isConnected ? lastInside : railStop())?.focus()
  }
  document.addEventListener('focusin', onFocusIn)
  onCleanup(() => document.removeEventListener('focusin', onFocusIn))

  // An accessor, drawn under `Index`, so a refetch of the node's workspaces rebuilds the row data but
  // not the buttons. A `For` here remounted every row on each refetch and dropped the focus the rail
  // had just taken.
  //
  // A workspace with projects carries a chevron. It is part of the row rather than a button of its own,
  // so the rail keeps one stop per row: a click on it and the Right and Left arrows expand and collapse,
  // and a click anywhere else opens the workspace's page.
  const railItem = (row: () => RailRow) => (
    <button
      type="button"
      class="settings-rail-item"
      data-depth={row().depth}
      aria-current={selection().page === row().key ? 'page' : undefined}
      aria-expanded={row().expanded}
      // One stop in the rail, the page on screen, so Tab moves into the page and the arrows move here.
      tabindex={selection().page === row().key ? 0 : -1}
      onClick={() => go({ page: row().key })}
      onKeyDown={(event) => {
        const workspaceId = row().workspaceId
        if (row().expanded === undefined || !workspaceId) return
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
        event.preventDefault()
        setOpen(workspaceId, event.key === 'ArrowRight')
      }}
    >
      <Show when={row().expanded !== undefined}>
        <span
          class="settings-rail-chevron"
          aria-hidden="true"
          onClick={(event) => {
            event.stopPropagation()
            const workspaceId = row().workspaceId
            if (workspaceId) setOpen(workspaceId, !row().expanded)
          }}
        >
          <Icon name={row().expanded ? 'chevron-down' : 'chevron-right'} />
        </span>
      </Show>
      <span class="settings-rail-label">{row().label}</span>
      <Show when={waiting(row().key)}><StatusDot tone="warn" label="Needs you" /></Show>
    </button>
  )

  const scopeChip = (resolved: Resolved) => {
    const scope = settingsScopeOf(resolved.page)
    if (scope === 'device') return <Badge>This device</Badge>
    if (scope === 'node') {
      return (
        <Show
          when={resolved.page.followsNodeSwitcher && nodes().length > 1}
          fallback={<Badge>Node: {nodeLabel(pageNode())}</Badge>}
        >
          <Select
            size="sm"
            width="auto"
            label="Node this page shows"
            value={switchedNode() ?? ''}
            options={nodes().map((node) => ({ value: node.nodeId, label: `Node: ${node.label}` }))}
            // Another node is another page: it remounts, so a form holding changes asks first.
            onChange={(value) => leave(() => setPickedNode(value))}
          />
        </Show>
      )
    }
    // A workspace or project page reads the active node, the one the workspaces list came from. The
    // title already names the workspace or project, so the chip says only which kind it is.
    return (
      <>
        <Badge>{resolved.project ? 'Project' : 'Workspace'}</Badge>
        <Show when={nodes().length > 1}><Badge>Node: {nodeLabel(activeNodeId())}</Badge></Show>
      </>
    )
  }

  return (
    <div
      ref={root}
      class="settings-view"
      // Focusable, so a confirmation that closes over a page whose button went away can hand the focus
      // back to the layer and Escape and ⌘[ still work (../../host/registries/shell/willPhase.tsx).
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      data-page-open={pageOpen() ? '' : undefined}
      onKeyDown={(event) => {
        if (event.key === '/' && !isTypingTarget(event.target)) {
          event.preventDefault()
          search?.focus()
          return
        }
        // Something inside took this key already, such as a page's own dialog closing itself.
        if (event.defaultPrevented) return
        if (eventChord(event) === 'meta+[' && back()) {
          event.preventDefault()
          goBack()
          return
        }
        dismiss.onKeyDown(event)
      }}
    >
      <nav class="settings-rail" aria-label="Settings pages">
        <Button variant="ghost" size="sm" onPress={close}><Icon name="arrow-left" /> Back to acorn</Button>
        <Input
          ref={(element) => { search = element }}
          type="search"
          kind="filter"
          size="sm"
          label="Search settings"
          placeholder="Search settings…"
          assist={false}
          value={query()}
          onInput={setQuery}
          onSubmit={() => { const first = matches()[0]; if (first) openResult(first) }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown') return
            event.preventDefault()
            root.querySelector<HTMLElement>('.settings-rail-item')?.focus()
          }}
        />
        <div class="settings-rail-list" ref={collection.attach}>
          <Show
            when={query().trim()}
            fallback={
              <Index each={groups()}>
                {(group) => (
                  <div class="settings-rail-group" role="group" aria-label={SETTINGS_CATEGORY_LABELS[group().category]}>
                    <div class="settings-rail-heading" aria-hidden="true">{SETTINGS_CATEGORY_LABELS[group().category]}</div>
                    <Index each={group().rows}>{railItem}</Index>
                  </div>
                )}
              </Index>
            }
          >
            <Show
              when={matches().length}
              fallback={<div class="settings-rail-empty"><EmptyState align="start" size="sm">No settings match "{query().trim()}".</EmptyState></div>}
            >
              <Index each={matches()}>
                {(result) => {
                  // The section is what someone searched for, so it is the result's name, with its page
                  // as a faint step above it. A section named like its page says the name once.
                  const crumb = () => {
                    const { pageLabel, sectionLabel } = result()
                    return sectionLabel && sectionLabel !== pageLabel ? pageLabel : undefined
                  }
                  return (
                    <button
                      type="button"
                      class="settings-rail-item settings-rail-result"
                      tabindex={-1}
                      onClick={() => openResult(result())}
                    >
                      <Show when={crumb()}>{(page) => <span class="settings-rail-result-page">{page()} ›</span>}</Show>
                      <span class="settings-rail-label">{crumb() ? result().sectionLabel : result().pageLabel}</span>
                      <Show when={result().matched}>
                        {(matched) => <span class="settings-rail-result-match">{matched()}</span>}
                      </Show>
                    </button>
                  )
                }}
              </Index>
            </Show>
          </Show>
        </div>
      </nav>

      <main class="settings-main">
        <Show when={current()}>
          {(resolved) => (
            <>
              <header class="settings-header">
                <div class="settings-heading-text">
                  <div class="settings-back-to-rail">
                    <Button variant="ghost" size="sm" onPress={() => setPageOpen(false)}><Icon name="chevron-left" /> Settings</Button>
                  </div>
                  <nav class="settings-breadcrumb" aria-label="Breadcrumb">
                    <Index each={crumbs()}>
                      {(crumb, at) => (
                        <>
                          <Show when={at > 0}><span aria-hidden="true"> › </span></Show>
                          <Show when={crumb().run} fallback={crumb().label}>
                            {(run) => (
                              <button
                                type="button"
                                class="settings-crumb"
                                data-tip={`Back to ${crumb().to}`}
                                data-tip-key={crumb().to === back()?.label ? '⌘[' : undefined}
                                onClick={() => run()()}
                              >
                                {crumb().label}
                              </button>
                            )}
                          </Show>
                        </>
                      )}
                    </Index>
                  </nav>
                  <div class="settings-title-line">
                    <h1 class="settings-title">{detail()?.title() ?? resolved().name}</h1>
                    <span class="settings-scopes">{scopeChip(resolved())}</span>
                    <span class="settings-close">
                      <IconButton icon="x" label="Close settings" tipKey="Esc" onPress={close} />
                    </span>
                  </div>
                </div>
              </header>
              {/* Between the header and the scrolling body, so a plugin's page cannot scroll over it, and
                  outside the box that holds the page, so nothing the plugin draws can sit on it. */}
              {/* Keyed, so one plugin's failed switch is not still said on the next plugin's page. */}
              <Show when={pluginOwner()} keyed>
                {(owner) => <PluginStrip pluginId={owner} railSources={resolved().page.railSourceVisibility} navigate={context.navigate} />}
              </Show>
              <div class="settings-body" data-plugin={pluginOwner() ? '' : undefined}>
                <div ref={pageElement} class="settings-page">
                  {/* A plain wrapper carries the live region, so the line is announced when it appears. */}
                  <Show when={status()}><div role="status"><Text emphasis="muted" wrap>{status()}</Text></div></Show>
                  {/* Its own boundary, so a page's lazy chunk holds only the page and not the rail. */}
                  <Suspense>
                    <Show when={pageKey()} keyed>
                      {(_key) => {
                        const page = untrack(() => resolved().page)
                        return (
                          <ContributionBoundary contributionId={`settings:${page.id}`} owner={settingsRegistry.ownerOf(page.id)}>
                            <UnsavedChangesContext.Provider value={unsaved}>
                              <SettingsDetailContext.Provider value={details}>
                                <Dynamic component={page.component} context={context} />
                              </SettingsDetailContext.Provider>
                            </UnsavedChangesContext.Provider>
                          </ContributionBoundary>
                        )
                      }}
                    </Show>
                  </Suspense>
                </div>
              </div>
            </>
          )}
        </Show>
      </main>
    </div>
  )
}
