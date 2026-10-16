import { For, Show, createResource, createSignal, onCleanup, onMount } from 'solid-js'
import type { NodeRecord } from '@acorn/protocol/broker.ts'
import type { BridgeHandoff, BridgeNodes, BridgeTaskPage } from '@acorn/protocol/extensionBridge.ts'
import type { ProjectSite, SiteAssociation } from '@acorn/protocol/siteAssociations.ts'
import Icon from '@acorn/client-core/kit/components/content/Icon.tsx'
import { Text } from '@acorn/client-core/kit/components/content'
import { IconButton } from '@acorn/client-core/kit/components/inputs'
import Picker from '@acorn/client-core/kit/components/inputs/Picker.tsx'
import { SettingRow, SettingsSection } from '@acorn/client-core/kit/components/layout'
import { Menu } from '@acorn/client-core/kit/components/overlays'
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Input,
  Row,
  SegmentedControl,
  StatusDot,
} from '@acorn/client-core/kit/components/primitives.tsx'
import type { BrowserApi } from '../browser'
import { STYLES, THEMES, loadAppearance, saveAppearance, type Appearance } from './appearance'
import type { BridgeClient } from './bridgeClient'
import { Sites } from './Sites'

// Everything that isn't the work, on one page in the desktop's settings parts: the paired Nodes, the
// sites the extension works on, notifications, and appearance.
export function Settings(props: {
  api: BrowserApi
  client: BridgeClient
  fleet: BridgeNodes | null
  online: boolean
  pair(): void
  select(nodeId: string): void
  rename(nodeId: string, label: string): void
  forget(nodeId: string): void
  handoffs: readonly BridgeHandoff[]
  sites: readonly ProjectSite[]
  // The apps plugins published for the selected Node's tasks, whose sites can be allowed.
  apps: readonly BridgeTaskPage[]
  pageUrl: string | undefined
  sitesChanged(projectId: string, sites: SiteAssociation[]): void
}) {
  return (
    <div class="view settings" aria-label="Settings">
      <Nodes
        fleet={props.fleet}
        online={props.online}
        pair={props.pair}
        select={props.select}
        rename={props.rename}
        forget={props.forget}
      />
      <Sites
        api={props.api}
        client={props.client}
        nodeId={props.fleet?.activeNodeId ?? null}
        online={props.online}
        handoffs={props.handoffs}
        sites={props.sites}
        apps={props.apps}
        pageUrl={props.pageUrl}
        changed={props.sitesChanged}
      />
      <Notifications permissions={props.api.permissions} />
      <AppearanceSettings storage={props.api.storage.local} />
    </div>
  )
}

// The Nodes this browser is paired with. The one in use has a dot for its connection; another has
// Use. Each has a menu to rename it here, copy its address, or forget it, which asks first.
function Nodes(props: {
  fleet: BridgeNodes | null
  online: boolean
  pair(): void
  select(nodeId: string): void
  rename(nodeId: string, label: string): void
  forget(nodeId: string): void
}) {
  // The Node whose name is a field. Outside the rows, which a renamed fleet draws again.
  const [renaming, setRenaming] = createSignal<string | null>(null)
  // Enter or leaving the field saves, as the desktop's rename does. Enter and the blur that follows
  // both arrive for one rename, so only the first saves.
  const commitRename = (node: NodeRecord, value: string) => {
    if (renaming() !== node.nodeId) return
    setRenaming(null)
    const label = value.trim()
    if (label && label !== node.label) props.rename(node.nodeId, label)
  }
  return (
    <SettingsSection
      id="nodes"
      label="Nodes"
      actions={
        <Button size="sm" variant="ghost" onPress={() => props.pair()}>
          <Icon name="plus" /> Pair
        </Button>
      }
    >
      <Show
        when={props.fleet?.nodes.length}
        fallback={
          <EmptyState align="start" size="sm">
            {/* Pairings live in the bridge, so until it answers the panel can't say there are none. */}
            {props.fleet
              ? 'No Node is paired with this browser yet.'
              : 'The paired Nodes show once the bridge answers.'}
          </EmptyState>
        }
      >
        <For each={props.fleet?.nodes}>
          {(node) => {
            const inUse = () => node.nodeId === props.fleet?.activeNodeId
            let field!: HTMLInputElement
            return (
              <Row
                variant="stacked"
                leading={
                  <Show when={inUse()} fallback={<StatusDot tone="muted" />}>
                    <StatusDot
                      tone={props.online ? 'ok' : 'danger'}
                      label={props.online ? 'Connected' : 'Not connected'}
                    />
                  </Show>
                }
                trailing={
                  <>
                    <Show
                      when={inUse()}
                      fallback={
                        <Button size="sm" onPress={() => props.select(node.nodeId)}>
                          Use
                        </Button>
                      }
                    >
                      <Badge size="xs">In use</Badge>
                    </Show>
                    <NodeMenu
                      node={node}
                      rename={() => setRenaming(node.nodeId)}
                      forget={() => props.forget(node.nodeId)}
                    />
                  </>
                }
              >
                <Show when={renaming() === node.nodeId} fallback={<Text>{node.label}</Text>}>
                  <Input
                    label="Node name"
                    name="node-name"
                    value={node.label}
                    maxLength={120}
                    ref={(element) => {
                      field = element
                      queueMicrotask(() => {
                        element.focus()
                        element.select()
                      })
                    }}
                    onSubmit={(value) => commitRename(node, value)}
                    onBlur={() => commitRename(node, field.value)}
                    // Handled here, so the Escape that ends a rename does nothing else.
                    onKeyDown={(event) => {
                      if (event.key !== 'Escape') return
                      event.preventDefault()
                      setRenaming(null)
                    }}
                  />
                </Show>
                <Text emphasis="mono" tone="muted">
                  {node.endpoint}
                </Text>
              </Row>
            )
          }}
        </For>
      </Show>
    </SettingsSection>
  )
}

// A Node's ⋯ menu. Forget arms first and asks "Forget <name>?", because pairing again takes a code.
function NodeMenu(props: { node: NodeRecord; rename(): void; forget(): void }) {
  return (
    <Menu
      ariaLabel={`${props.node.label} actions`}
      placement="bottom-end"
      trigger={(state) => (
        <IconButton
          icon="ellipsis"
          label="Node actions"
          variant="ghost"
          size="sm"
          opens="menu"
          expanded={state.open()}
          onPress={state.toggle}
        />
      )}
    >
      {(context) => (
        <>
          <Menu.Item context={context} leading={<Icon name="pencil" />} onSelect={() => props.rename()}>
            Rename
          </Menu.Item>
          <Menu.Item
            context={context}
            leading={<Icon name="copy" />}
            trailing={props.node.endpoint}
            onSelect={() => void navigator.clipboard.writeText(props.node.endpoint).catch(() => {})}
          >
            Copy address
          </Menu.Item>
          <Menu.Separator />
          <Menu.Item
            context={context}
            leading={<Icon name="trash-2" />}
            tone="danger"
            confirm={`Forget ${props.node.label}?`}
            onSelect={() => props.forget()}
          >
            Forget {props.node.label}
          </Menu.Item>
        </>
      )}
    </Menu>
  )
}

const NOTIFICATIONS = { permissions: ['notifications'] }

// The opt-in for OS notifications. The browser permission is the setting, so turning it off in the
// browser's settings turns it off here. docs/browser-extension/notifications.md.
export function Notifications(props: { permissions: BrowserApi['permissions'] }) {
  const [allowed, { refetch }] = createResource(() => props.permissions.contains(NOTIFICATIONS))
  const onAccess = () => void refetch()
  onMount(() => {
    props.permissions.onAdded.addListener(onAccess)
    props.permissions.onRemoved.addListener(onAccess)
  })
  onCleanup(() => {
    props.permissions.onAdded.removeListener(onAccess)
    props.permissions.onRemoved.removeListener(onAccess)
  })
  // `request` must run inside the person's click, so nothing is awaited before it. A declined prompt
  // fires no permission event and answers false, which puts the switch back.
  const toggle = (on: boolean) =>
    (on ? props.permissions.request(NOTIFICATIONS) : props.permissions.remove(NOTIFICATIONS)).catch(() => false)
  return (
    <SettingsSection id="notifications" label="Notifications">
      <SettingRow label="When an agent needs you" description="For projects of the page you are on">
        <Checkbox switch name="notify" checked={allowed() === true} onChange={toggle} />
      </SettingRow>
    </SettingsSection>
  )
}

// Light and Dark side by side, for System, which follows the computer's choice between them.
const SYSTEM_SWATCH = `linear-gradient(135deg, ${THEMES[0]![2]} 50%, ${THEMES[1]![2]} 50%)`
type ThemeChoice = { id: string | null; label: string; swatch: string }
const THEME_CHOICES: readonly ThemeChoice[] = [
  { id: null, label: 'System', swatch: SYSTEM_SWATCH },
  ...THEMES.map(([id, label, swatch]) => ({ id, label, swatch })),
]
const Swatch = (props: { colour: string }) => <span class="swatch" style={{ background: props.colour }} />

// The panel's theme and style pack. Saving is enough: every open panel applies the stored choice.
function AppearanceSettings(props: { storage: BrowserApi['storage']['local'] }) {
  const [appearance, setAppearance] = createSignal<Appearance>({
    theme: null,
    style: 'terminal',
  })
  onMount(async () => setAppearance(await loadAppearance(props.storage)))
  const change = (next: Partial<Appearance>) => {
    setAppearance({ ...appearance(), ...next })
    void saveAppearance(props.storage, appearance())
  }
  const theme = () => THEME_CHOICES.find((choice) => choice.id === appearance().theme) ?? THEME_CHOICES[0]!
  return (
    <SettingsSection id="appearance" label="Appearance">
      <SettingRow label="Theme">
        <Picker<ThemeChoice>
          label={
            <>
              <Swatch colour={theme().swatch} /> {theme().label}
            </>
          }
          ariaLabel="Theme"
          size="sm"
          placement="bottom-end"
          placeholder="Filter themes"
          emptyText="No theme matches."
          results={(query) =>
            THEME_CHOICES.filter((choice) => choice.label.toLowerCase().includes(query.trim().toLowerCase()))
          }
          rowLabel={(choice) => choice.label}
          isActive={(choice) => choice.id === appearance().theme}
          leading={(choice) => <Swatch colour={choice.swatch} />}
          onSelect={(choice) => change({ theme: choice.id })}
        />
      </SettingRow>
      <SettingRow label="Style">
        <SegmentedControl
          options={STYLES.map(([value, label]) => ({ value, label }))}
          value={appearance().style}
          onChange={(style) => change({ style })}
          size="sm"
          ariaLabel="Style"
        />
      </SettingRow>
    </SettingsSection>
  )
}
