import { For, Show } from 'solid-js'
import type { TopbarProps } from '@acorn/protocol/chrome.ts'
import Picker from '../../kit/components/inputs/Picker'
import { Button, Select } from '../../kit/components/primitives'
import { IconButton } from '../../kit/components/inputs/IconButton'
import NodeChip from '../../features/fleet/NodeChip'
import OverflowMenu from '../../features/settings/OverflowMenu'
import { NestedChromeSlot } from '../plugins/NestedChromeSlot'

/** Core's topbar uses the same public data and verbs as an offered replacement. */
export default function Topbar(own: { value?: unknown }) {
  const props = () => own.value as TopbarProps
  const workspaceResults = (query: string) => {
    const q = query.trim().toLowerCase()
    return props().workspaces.filter((entry) => `${entry.label} ${entry.nodeLabel}`.toLowerCase().includes(q))
  }
  const projectResults = (query: string) => {
    const q = query.trim().toLowerCase()
    return props().projects.filter((entry) => entry.label.toLowerCase().includes(q))
  }
  return (
    <div class="topbar">
      <div class="topbar-side">
        <IconButton icon="panel-left" label={props().railCollapsed ? 'Expand rail' : 'Collapse rail'}
          onPress={props().collapseRail} />
        <Show when={props().workspaces.length}>
          <Picker
            label={props().workspace?.label ?? 'Select a workspace'}
            placeholder="Filter workspaces…" emptyText="No workspaces."
            results={workspaceResults}
            rowLabel={(entry) => `${entry.label}${props().nodes.length > 1 ? ` · ${entry.nodeLabel}` : ''}${entry.projectCount ? ` (${entry.projectCount})` : ''}`}
            isActive={(entry) => entry.id === props().workspace?.id && entry.nodeId === props().node?.id}
            onSelect={(entry) => props().pickWorkspace(entry.id, entry.nodeId)}
          />
        </Show>
        <Show when={props().projectPickerVisible}>
          <Picker
            label={props().project?.label ?? 'Select a project'}
            ariaLabel="Project" placeholder="Filter projects…" emptyText="No projects."
            results={projectResults}
            rowLabel={(entry) => entry.label}
            isActive={(entry) => entry.id === props().project?.id}
            disabled={props().projectPickerDisabled}
            onSelect={(entry) => props().pickProject(entry.id)}
          />
        </Show>
      </div>
      <div class="breadcrumb">
        <Show when={props().breadcrumb.length} fallback={<span class="brand">acorn</span>}>
          <For each={props().breadcrumb}>
            {(crumb, index) => (
              <>
                <Show when={index() > 0}><span class="crumb-sep">/</span></Show>
                <Show when={crumb.route} fallback={<span class="crumb crumb-num">{crumb.label}</span>}>
                  {(route) => <Button variant="bare" onPress={() => props().navigate(route())}>{crumb.label}</Button>}
                </Show>
              </>
            )}
          </For>
        </Show>
      </div>
      <div class="topbar-side topbar-end">
        <Show when={props().nodes.length > 1 || import.meta.env.DEV}>
          <Select width="auto" label="Active node" value={props().node?.id ?? ''}
            onChange={(value) => props().pickNode(value)}
            options={props().nodes.map((node) => ({ value: node.id, label: node.label }))} />
        </Show>
        <Show when={props().node}>{(node) => <NodeChip nodeId={node().id} compact={props().nodes.length <= 1} query={{}} />}</Show>
        <NestedChromeSlot slotRef={props().slots.right} />
        <OverflowMenu onSettings={props().openSettings} onClearCache={props().clearCache} />
      </div>
    </div>
  )
}
