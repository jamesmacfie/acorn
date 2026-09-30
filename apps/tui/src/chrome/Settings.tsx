/** @jsxImportSource @acorn/tui/jsx */
import { createMemo, Match, onCleanup, Show, Switch, type JSX } from 'solid-js'
import type { Renderable } from '../tree/compat'
import { Dynamic } from '../tree/renderer'
import { nodes } from '@acorn/client-core/infra/node/fleet.ts'
import { SETTINGS_CATEGORIES } from '@acorn/protocol/settingsPages.ts'
import {
  createSettingsDetails, createUnsavedChanges, SettingsDetailContext, UnsavedChangesContext,
} from '@acorn/client-core/features/settings'
import {
  SETTINGS_CATEGORY_LABELS, settingsCategoryOf, settingsScopeOf, type SettingsCategory, type SettingsContribution,
  type SettingsPageContext,
} from '@acorn/client-core/host/registries/shell'
import { Line } from '../kit/cells'
import { Button } from '../kit/asking'
import { Alert, Row, Rows } from '../kit/showing'
import { boxBorder } from '../kit/roles'
import { ScrollViewport } from '../kit/scrolling'
import { trapKeys } from '../keys/trap'
import { focusedRenderable, focusRenderable, isField, pushScope, scheduleSettle, stopsIn } from '../keys/regions'
import { PanelBody } from '../panel'
import { confirmAction } from './confirmStore'
import { drawnElsewhere, type DrawnElsewhere } from './settingsPages'
import { listedSettingsPages, placeFor, setSettingsPlace, settingsMissing, settingsPlace } from './settingsStore'

// The terminal's Settings route: the desktop's nine groups, each group's pages, and a page (docs/tui.md
// § Settings). The same registry the desktop's settings view reads, projected the way the desktop's
// narrow window projects it: the list is its own screen and a page opens over it, because 80 by 24
// has no room for a rail beside a form.
//
// Enter goes down a level and Escape comes back up one: a page's open detail, then the page, then the
// group, then the route itself. That is the unwind every other screen here has. A form that holds
// unsaved changes asks before any of them, through the shell's one confirmation (./Confirmation.tsx).

/** What the header chip says: what a change on the page affects. One node per run on this host, so a
 *  node page names the node this client is attached to, which is the node every page body reads. */
function scopeText(page: SettingsContribution, nodeId: string): string {
  if (settingsScopeOf(page) === 'device') return 'This device'
  return `Node: ${nodes().find((node) => node.nodeId === nodeId)?.label ?? nodeId}`
}

export function Settings(props: { nodeId: string; onClose: () => void; onSetup: () => void }) {
  let root: Renderable | undefined
  const pages = createMemo(() => listedSettingsPages())
  const page = () => pages().find((candidate) => candidate.id === settingsPlace().pageId)
  const category = () => settingsPlace().category
  const inGroup = (id: SettingsCategory) => pages().filter((candidate) => settingsCategoryOf(candidate) === id)

  const unsaved = createUnsavedChanges()
  const details = createSettingsDetails()
  // Every way off a page comes through here, as on the desktop (client-core SettingsView.tsx § leave).
  const leave = (then: () => void) => {
    const go = () => {
      // The keys leave a text field first, so it commits what was typed on its blur before the page
      // that holds it is gone: a field that unmounts while it has the keys never blurs.
      const typing = focusedRenderable()
      if (root && typing && isField(typing)) focusRenderable(root)
      then()
      // …and then onto the first stop of what replaced the page. The frame is still a live stop, so
      // the landing rule would leave the keys on it and the list under them would have no caret.
      if (root && focusedRenderable() === root) {
        const first = stopsIn(root)[0]
        if (first) focusRenderable(first)
        scheduleSettle()
      }
    }
    if (!unsaved.dirty()) return go()
    void confirmAction({
      title: 'Discard unsaved changes?',
      actionLabel: 'Discard changes',
      goes: 'This page has changes that are not saved yet. Leaving drops them.',
      stays: 'Everything already saved stays as it is.',
      danger: true,
    }).then((discard) => { if (discard) go() })
  }
  const back = () => {
    const detail = details.current()
    if (detail) return leave(detail.back)
    if (settingsPlace().pageId) return leave(() => setSettingsPlace({ category: category() }))
    if (category()) return setSettingsPlace({})
    props.onClose()
  }
  trapKeys(back)

  const context: SettingsPageContext = {
    scope: { nodeId: props.nodeId },
    navigate: (target, opened) => leave(() => {
      const next = placeFor(target)
      if (!next) return
      setSettingsPlace(next)
      opened?.()
    }),
    onWorkspaceDeleted: () => {},
  }

  // `>` between the parts, as the topbar writes its path, because `›` is the caret on this host and a
  // second one on screen would read as a second focus (../reachability.test.tsx, invariant 3).
  const crumbs = () => {
    const at = category()
    const open = page()
    const title = details.current()?.title()
    return ['Settings', ...(at ? [SETTINGS_CATEGORY_LABELS[at]] : []), ...(open ? [open.title ?? open.label] : []), ...(title ? [title] : [])]
      .join(' > ')
  }

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      minHeight={0}
      {...boxBorder('surface')}
      title="Settings"
      paddingLeft={1}
      paddingRight={1}
      ref={(element: Renderable) => { root = element; onCleanup(pushScope(element)) }}
    >
      <Line role="muted">{crumbs()}</Line>
      <Show when={settingsMissing()}><Alert tone="warn">{settingsMissing()}</Alert></Show>
      <Switch fallback={<Groups count={(id) => inGroup(id).length} />}>
        <Match when={page()} keyed>
          {(open) => (
            <PageView page={open} nodeId={props.nodeId} onSetup={props.onSetup}>
              <SettingsDetailContext.Provider value={details}>
                <UnsavedChangesContext.Provider value={unsaved}>
                  <Dynamic component={open.component} context={context} />
                </UnsavedChangesContext.Provider>
              </SettingsDetailContext.Provider>
            </PageView>
          )}
        </Match>
        <Match when={category()} keyed>
          {(at) => <Pages category={at} pages={inGroup(at)} nodeId={props.nodeId} />}
        </Match>
      </Switch>
    </box>
  )
}

/** The nine groups, every one of them, with how many pages each holds on this node. */
function Groups(props: { count: (id: SettingsCategory) => number }) {
  const items = () => SETTINGS_CATEGORIES.map((id) => ({ key: id, label: SETTINGS_CATEGORY_LABELS[id] }))
  return (
    <Rows id="settings.groups" ariaLabel="Settings groups" items={items()}
      onActivate={(key) => setSettingsPlace({ category: key as SettingsCategory })}>
      {(entry, item) => {
        const count = () => props.count(entry.key)
        return <Row item={item} meta={count() === 1 ? '1 page' : `${count()} pages`}>{entry.label}</Row>
      }}
    </Rows>
  )
}

/** One group's pages, each marked with what it affects and, when this host does not draw it, that it
 *  opens in the desktop app. Listed either way, so the route is the whole map of settings. */
function Pages(props: { category: SettingsCategory; pages: readonly SettingsContribution[]; nodeId: string }) {
  const items = () => props.pages.map((page) => ({ key: page.id, label: page.title ?? page.label, page }))
  return (
    <Show when={items().length} fallback={<Line role="muted">No pages in this group on this node.</Line>}>
      <Rows id={`settings.pages.${props.category}`} ariaLabel={SETTINGS_CATEGORY_LABELS[props.category]} items={items()}
        onActivate={(key) => setSettingsPlace({ category: props.category, pageId: key })}>
        {(entry, item) => (
          <Row item={item} meta={drawnElsewhere(entry.page) ? `${scopeText(entry.page, props.nodeId)} · desktop app` : scopeText(entry.page, props.nodeId)}>
            {entry.label}
          </Row>
        )}
      </Rows>
    </Show>
  )
}

/** One page: its title and scope, then its body in a viewport the keys scroll as they move. The body
 *  is the page's own component, or the explanation this host gives instead of one. */
function PageView(props: {
  page: SettingsContribution
  nodeId: string
  onSetup: () => void
  children: JSX.Element
}) {
  const elsewhere = drawnElsewhere(props.page)
  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <box flexDirection="row" gap={2} flexShrink={0}>
        <Line role="strong">{props.page.title ?? props.page.label}</Line>
        <Line role="muted">{scopeText(props.page, props.nodeId)}</Line>
      </box>
      <ScrollViewport>
        <PanelBody name={props.page.label} nodeId={props.nodeId}>
          {elsewhere ? <Elsewhere info={elsewhere} onSetup={props.onSetup} /> : props.children}
        </PanelBody>
      </ScrollViewport>
    </box>
  )
}

function Elsewhere(props: { info: DrawnElsewhere; onSetup: () => void }) {
  return (
    <box flexDirection="column" rowGap={1} flexShrink={0}>
      <Line role="strong" wrap>This page opens in the desktop app.</Line>
      <Line wrap>{props.info.why}</Line>
      <Line wrap>{props.info.where}</Line>
      <Show when={props.info.file}>{(file) => <Line role="muted" wrap>{`This terminal reads the same settings from ${file()}.`}</Line>}</Show>
      <Show when={props.info.setup}>
        <Line wrap>Set up acorn adds a workspace, a project, or a task from this terminal.</Line>
        <Button onPress={props.onSetup}>Set up acorn</Button>
      </Show>
    </box>
  )
}
