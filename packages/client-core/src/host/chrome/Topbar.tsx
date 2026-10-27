import { For, Show } from 'solid-js'
import type { TopbarProps } from '@acorn/protocol/chrome.ts'
import Picker from '../../kit/components/inputs/Picker'
import { Button } from '../../kit/components/primitives'
import NodeChip from '../../features/fleet/NodeChip'
import OverflowMenu from '../../features/settings/OverflowMenu'
import { NestedChromeSlot } from '../plugins/NestedChromeSlot'
import { WorkspaceIdentity } from '../../features/workspaces/WorkspaceIcon'

/** Core's topbar uses the same public data and verbs as an offered replacement. */
export default function Topbar(own: { value?: unknown }) {
  const props = () => own.value as TopbarProps
  const workspaceResults = (query: string) => {
    const q = query.trim().toLowerCase()
    return props().workspaces.filter((entry) => entry.label.toLowerCase().includes(q))
  }
  const nodeResults = (query: string) => {
    const q = query.trim().toLowerCase()
    return props().nodes.filter((entry) => entry.label.toLowerCase().includes(q))
  }
  const projectResults = (query: string) => {
    const q = query.trim().toLowerCase()
    return props().projects.filter((entry) => entry.label.toLowerCase().includes(q))
  }
  return (
    <div class="topbar">
      <div class="topbar-side">
        {/* With one node there's nothing to switch to, so its state shows as a chip at the far end instead. */}
        <Show when={props().nodes.length > 1}>
          <Picker
            size="sm"
            label={
              <span class="workspace-identity-label">
                <Show when={props().node}>{(node) => <NodeChip nodeId={node().id} query={{}} dot />}</Show>
                {props().node?.label ?? 'Select a node'}
              </span>
            }
            ariaLabel="Node"
            placeholder="Filter nodes…"
            emptyText="No nodes."
            results={nodeResults}
            leading={(entry) => <NodeChip nodeId={entry.id} query={{}} dot />}
            rowLabel={(entry) => entry.label}
            isActive={(entry) => entry.id === props().node?.id}
            onSelect={(entry) => props().pickNode(entry.id)}
          />
        </Show>
        <Show when={props().workspacesMode && props().workspacePickerVisible !== false && props().workspaces.length}>
          <Picker
            size="sm"
            label={
              <span class="workspace-identity-label">
                <Show when={props().workspace}>
                  {(workspace) => (
                    <WorkspaceIdentity
                      name={workspace().label}
                      appearance={workspace().appearance}
                      nodeId={props().node?.id}
                    />
                  )}
                </Show>
                {props().workspace?.label ??
                  (props().workspacesMode === 'off' ? 'Select a project' : 'Select a workspace')}
              </span>
            }
            ariaLabel={props().workspacesMode === 'off' ? 'Project' : 'Workspace'}
            placeholder={props().workspacesMode === 'off' ? 'Filter projects…' : 'Filter workspaces…'}
            emptyText={props().workspacesMode === 'off' ? 'No projects.' : 'No workspaces.'}
            results={workspaceResults}
            leading={(entry) => (
              <WorkspaceIdentity name={entry.label} appearance={entry.appearance} nodeId={entry.nodeId} />
            )}
            rowLabel={(entry) => entry.label}
            rowDescription={(entry) =>
              props().workspacesMode === 'off'
                ? undefined
                : entry.projectCount
                  ? `${entry.projectCount} project${entry.projectCount === 1 ? '' : 's'}`
                  : undefined
            }
            isActive={(entry) => entry.id === props().workspace?.id && entry.nodeId === props().node?.id}
            onSelect={(entry) => props().pickWorkspace(entry.id, entry.nodeId)}
            footer={
              props().canAddProject
                ? (close) => (
                    <Button
                      variant="ghost"
                      size="sm"
                      onPress={() => {
                        close()
                        props().addProject()
                      }}
                    >
                      Add project…
                    </Button>
                  )
                : undefined
            }
          />
        </Show>
        <Show when={props().workspacesMode === 'on' && props().projectPickerVisible}>
          <Picker
            size="sm"
            label={props().project?.label ?? 'Select a project'}
            ariaLabel="Project"
            placeholder="Filter projects…"
            emptyText="No projects."
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
                <Show when={index() > 0}>
                  <span class="crumb-sep">/</span>
                </Show>
                <Show when={crumb.route} fallback={<span class="crumb crumb-num">{crumb.label}</span>}>
                  {(route) => (
                    <Button variant="ghost" size="sm" onPress={() => props().navigate(route())}>
                      {crumb.label}
                    </Button>
                  )}
                </Show>
              </>
            )}
          </For>
        </Show>
      </div>
      <div class="topbar-side topbar-end">
        <Show when={props().nodes.length <= 1 && props().node}>
          {(node) => <NodeChip nodeId={node().id} compact query={{}} />}
        </Show>
        <NestedChromeSlot slotRef={props().slots.right} />
        <OverflowMenu
          onSettings={props().openSettings}
          onClearCache={props().clearCache}
          onCopyLink={props().copyLink}
        />
      </div>
    </div>
  )
}
