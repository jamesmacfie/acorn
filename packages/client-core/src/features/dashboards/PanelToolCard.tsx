import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'
import { useLocation, useNavigate } from '@solidjs/router'
import { useQueryClient } from '@tanstack/solid-query'
import { panelPlanSchema, type PanelPlan, type PanelShowResult } from '@acorn/protocol/dashboards.ts'
import type { AgentToolCardProps } from '@acorn/protocol/extensionPoints.ts'
import { Alert, Button, CodeBlock } from '../../kit/components/primitives'
import { Inline } from '../../kit/components/layout/Inline'
import { Stack } from '../../kit/components/layout/Stack'
import { Text } from '../../kit/components/content/Text'
import { Menu } from '../../kit/components/overlays/Menu'
import { activeCacheId } from '../../infra/node/activeNode'
import { sourceOpeningPath } from '../../host/registries/sources/sources'
import { allProjects } from '../projects/projectLookup'
import { setSelectedSource } from '../tasks/tasks'
import { taskById } from '../tasks/taskLookup'
import { toast } from '../notifications/toast'
import { dashboardClient } from './dashboardClient'
import { dashboardRecoveryStore } from './dashboardRecovery'
import DashboardPanelHost from './DashboardPanelHost'
import { setActiveHomeTab } from './homeTab'
import { addNewPanel } from './panelPublish'
import { readPanelShowCall } from './panelShowCall'
import { dashboards, homeTabs, homeTabScope, type DashboardTab, type PlacementScope } from './persist'
import PublishedDashboardPanel from './PublishedDashboardPanel'
import './dashboards.css'

// The transcript card for an agent's `panel_show` call (docs/dashboards.md § Panels from a
// conversation). The plan lives in the call, so the card runs it itself, under this device, through
// the ordinary run route, and draws it with the dashboard's own panel.

/** The newest `shownAt` per task and panel id. A card older than its panel's newest collapses, so it
 *  never redraws as somebody else's version. Kept for the client's life rather than per mount, so a
 *  card scrolled back into view still knows a newer one exists. */
const [newest, setNewest] = createSignal<Record<string, number>>({})

/** A harness reports a refused call as completed, with the error as its output, so anything finished
 *  without a result is a plan that didn't pass. */
const stillChecking = (status: string | undefined): boolean => status === 'pending' || status === 'running'

export default function PanelToolCard(props: AgentToolCardProps) {
  const call = createMemo(() => readPanelShowCall(props.tool))
  const input = () => call().input
  const plan = createMemo((): PanelPlan | undefined => {
    const parsed = panelPlanSchema.safeParse(input()?.plan)
    // The agent's title is what the card says, so it is also what a dashboard says after Add.
    return parsed.success ? { ...parsed.data, title: input()!.title } : undefined
  })
  // The transcript hands over a fresh call on every snapshot, and a finished call never changes, so the
  // card is the same card for as long as its panel and version are.
  const card = createMemo(
    () => {
      const result = props.tool.status === 'completed' ? call().result : undefined
      return result && plan() ? { result, plan: plan()! } : undefined
    },
    undefined,
    { equals: (a, b) => a?.result.panelId === b?.result.panelId && a?.result.shownAt === b?.result.shownAt },
  )
  return (
    <Show
      when={card()}
      keyed
      fallback={
        <Show
          when={!stillChecking(props.tool.status)}
          fallback={<Text tone="muted">{`Checking the plan for ${input()?.title ?? 'a panel'}…`}</Text>}
        >
          <Stack gap="row">
            <Alert tone="warn">{`${input()?.title ?? 'This panel'} didn't pass its checks, so nothing was drawn.`}</Alert>
            <Show when={props.tool.output}>
              {(output) => (
                <CodeBlock wrap maxHeight="block">
                  {output()}
                </CodeBlock>
              )}
            </Show>
          </Stack>
        </Show>
      }
    >
      {(card) => <PanelCard taskId={props.taskId} result={card.result} plan={card.plan} />}
    </Show>
  )
}

function PanelCard(props: { taskId: string; result: PanelShowResult; plan: PanelPlan }) {
  const key = `${props.taskId}:${props.result.panelId}`
  createEffect(() =>
    setNewest((current) =>
      (current[key] ?? 0) >= props.result.shownAt ? current : { ...current, [key]: props.result.shownAt },
    ),
  )
  const replaced = () => (newest()[key] ?? 0) > props.result.shownAt
  const [showOld, setShowOld] = createSignal(false)

  const nodeId = activeCacheId()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const projectId = () => taskById(props.taskId)?.projectId
  const workspaceId = () => allProjects().find((project) => project.id === projectId())?.workspaceId ?? ''
  const tabs = (): DashboardTab[] => {
    const named = homeTabs(dashboards(), workspaceId())
    return named.length ? named : [{ id: '', name: 'Home' }]
  }

  const [added, setAdded] = createSignal<DashboardTab>()
  const [studio, setStudio] = createSignal<{ dashboardId: string; scope: PlacementScope }>()
  const add = async (tab: DashboardTab) => {
    const placement = homeTabScope(tab.id, workspaceId())
    try {
      const saved = await addNewPanel({
        nodeId,
        scope: { workspaceId: workspaceId() },
        plan: props.plan,
        placement,
        queryClient,
        recovery: dashboardRecoveryStore(typeof localStorage === 'undefined' ? undefined : localStorage),
      })
      setAdded(tab)
      toast('Panel added.', {
        action: { label: 'Edit…', onPress: () => setStudio({ dashboardId: saved.id, scope: placement }) },
      })
    } catch {
      toast("Couldn't add the panel. Try again.", { tone: 'danger' })
    }
  }
  const editInStudio = async () => {
    try {
      const draft = await dashboardClient(nodeId, { workspaceId: workspaceId() }).create(props.plan)
      setStudio({ dashboardId: draft.id, scope: homeTabScope('', workspaceId()) })
    } catch {
      toast("Couldn't open the studio. Try again.", { tone: 'danger' })
    }
  }
  // The rail click's rule (features/tabs/TabRail.tsx § selectSource): Home, scoped to the task's project.
  const openTab = (tab: DashboardTab) => {
    setActiveHomeTab(tab.id)
    setSelectedSource('home')
    const path = sourceOpeningPath('home', location.pathname, projectId())
    if (path) navigate(path)
  }

  // Runs only while on screen, so a long conversation of cards doesn't keep reading its sources.
  const [inView, setInView] = createSignal(false)
  const [expanded, setExpanded] = createSignal(false)
  const [overflows, setOverflows] = createSignal(false)
  const watchFrame = (frame: HTMLDivElement) => {
    if (typeof IntersectionObserver === 'undefined' || typeof ResizeObserver === 'undefined')
      return void setInView(true)
    const visibility = new IntersectionObserver(([entry]) => setInView(!!entry?.isIntersecting))
    visibility.observe(frame)
    const size = new ResizeObserver(() => setOverflows(frame.scrollHeight > frame.clientHeight))
    size.observe(frame)
    queueMicrotask(() => frame.firstElementChild && size.observe(frame.firstElementChild))
    onCleanup(() => {
      visibility.disconnect()
      size.disconnect()
    })
  }

  return (
    <>
      <Show
        when={!replaced() || showOld()}
        fallback={
          <Inline spread>
            <Text tone="muted">{`${props.plan.title}. Replaced by a newer version.`}</Text>
            <Button size="sm" variant="ghost" onPress={() => setShowOld(true)}>
              Show
            </Button>
          </Inline>
        }
      >
        <Stack gap="row">
          <div ref={watchFrame} class="dash-card-frame" data-expanded={expanded() ? '' : undefined}>
            <PublishedDashboardPanel
              definition={{ id: props.result.panelId, title: props.plan.title, shaping: {}, view: props.plan.view }}
              workspaceId={workspaceId()}
              plan={props.plan}
              active={inView()}
              actions={() => (
                <>
                  <Menu
                    ariaLabel="Add to dashboard"
                    placement="bottom-end"
                    trigger={({ open, toggle }) => (
                      <Button size="xs" variant="ghost" opens="menu" expanded={open()} onPress={toggle}>
                        Add to dashboard
                      </Button>
                    )}
                  >
                    {(menu) => (
                      <For each={tabs()}>
                        {(tab) => (
                          <Menu.Item context={menu} onSelect={() => void add(tab)}>
                            {tab.name}
                          </Menu.Item>
                        )}
                      </For>
                    )}
                  </Menu>
                  <Button size="xs" variant="ghost" onPress={() => void editInStudio()}>
                    Edit in studio
                  </Button>
                </>
              )}
            />
          </div>
          <Show when={overflows() || expanded()}>
            <Button size="sm" variant="ghost" onPress={() => setExpanded((value) => !value)}>
              {expanded() ? 'Collapse' : 'Expand'}
            </Button>
          </Show>
          <Show when={added()}>
            {(tab) => (
              <Inline spread>
                <Text tone="muted">{`Added to ${tab().name}.`}</Text>
                <Button size="sm" variant="ghost" onPress={() => openTab(tab())}>
                  Open
                </Button>
              </Inline>
            )}
          </Show>
          <Show when={replaced()}>
            <Button size="sm" variant="ghost" onPress={() => setShowOld(false)}>
              Hide this version
            </Button>
          </Show>
        </Stack>
      </Show>
      <DashboardPanelHost
        session={studio() && { dashboardId: studio()!.dashboardId }}
        scope={studio()?.scope ?? homeTabScope('', workspaceId())}
        returnLabel="Conversation"
        onClose={() => setStudio(undefined)}
      />
    </>
  )
}
