import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'
import { useLocation, useNavigate } from '@solidjs/router'
import { useQueryClient } from '@tanstack/solid-query'
import { panelPlanSchema, type PanelPlan, type PanelShowResult } from '@acorn/protocol/dashboards.ts'
import type { AgentToolCardProps } from '@acorn/protocol/extensionPoints.ts'
import { Alert, Button, CodeBlock } from '../../kit/components/primitives'
import { Inline } from '../../kit/components/layout/Inline'
import { Stack } from '../../kit/components/layout/Stack'
import { Text } from '../../kit/components/content/Text'
import { Menu, type MenuContext } from '../../kit/components/overlays/Menu'
import { activeCacheId } from '../../infra/node/activeNode'
import { sourceOpeningPath } from '../../host/registries/sources/sources'
import { allProjects } from '../projects/projectLookup'
import { setSelectedSource } from '../tasks/tasks'
import { taskById } from '../tasks/taskLookup'
import { toast } from '../notifications/toast'
import { dashboardClient } from './dashboardClient'
import { dashboardRecoveryStore } from './dashboardRecovery'
import CardFrame from './CardFrame'
import DashboardPanelHost from './DashboardPanelHost'
import { homeTabsToAddTo } from './cells'
import { setActiveHomeTab } from './homeTab'
import { addNewPanel, describePanelSources, publishFailureMessage, type PanelPublicationMetadata } from './panelPublish'
import { readPanelShowCall } from './panelShowCall'
import { homeTabScope, type DashboardTab, type PlacementScope } from './persist'
import { panelRegionRegistry, regionsToAddTo, type PanelRegion } from './region'
import PublishedDashboardPanel from './PublishedDashboardPanel'
import KeepUpdatedSheet from './KeepUpdatedSheet'
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
  /** Where the panel went, named under the card, and how to open it there. */
  const [added, setAdded] = createSignal<{ name: string; open?: () => void }>()
  const [studio, setStudio] = createSignal<{ dashboardId: string; scope: PlacementScope; region?: PanelRegion }>()
  type Destination = { name: string; scope: PlacementScope; region?: PanelRegion; open?: () => void }
  const place = async (destination: Destination, plan: PanelPlan) => {
    const { scope, region } = destination
    const saved = await addNewPanel({
      nodeId,
      scope: { workspaceId: workspaceId() },
      plan,
      placement: scope,
      ...(region ? { region } : {}),
      queryClient,
      recovery: dashboardRecoveryStore(typeof localStorage === 'undefined' ? undefined : localStorage),
    })
    setAdded(destination)
    toast('Panel added.', {
      action: {
        label: 'Edit…',
        onPress: () => setStudio({ dashboardId: saved.id, scope, ...(region ? { region } : {}) }),
      },
    })
  }
  const add = (destination: Destination) =>
    place(destination, props.plan).catch((error: unknown) =>
      toast(publishFailureMessage(error, "Couldn't add the panel. Try again."), { tone: 'danger' }),
    )
  /** Rows the agent supplied, which Add to dashboard can place as they are or keep up to date. */
  const supplied = () => {
    const reference = props.plan.sources[0]?.reference
    return reference?.kind === 'supplied' ? reference : undefined
  }
  const [keeping, setKeeping] = createSignal<Destination>()
  const homeTab = (tab: DashboardTab): Destination => ({
    name: tab.name,
    scope: homeTabScope(tab.id, workspaceId()),
    open: () => openTab(tab),
  })
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
          <CardFrame onVisible={setInView}>
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
                      <>
                        <Show when={supplied()}>
                          <Menu.Label>Place as a snapshot</Menu.Label>
                        </Show>
                        <For each={homeTabsToAddTo(workspaceId())}>
                          {(tab) => (
                            <Menu.Item context={menu} onSelect={() => void add(homeTab(tab))}>
                              {tab.name}
                            </Menu.Item>
                          )}
                        </For>
                        <RegionItems
                          menu={menu}
                          nodeId={nodeId}
                          workspaceId={workspaceId()}
                          plan={props.plan}
                          onSelect={(region) =>
                            void add({ name: region.label, scope: region.scope, region: region.region })
                          }
                        />
                        <Show when={supplied() && projectId()}>
                          <Menu.Separator />
                          <Menu.Label>Keep it up to date</Menu.Label>
                          <For each={homeTabsToAddTo(workspaceId())}>
                            {(tab) => (
                              <Menu.Item context={menu} onSelect={() => setKeeping(homeTab(tab))}>
                                {`${tab.name}…`}
                              </Menu.Item>
                            )}
                          </For>
                        </Show>
                      </>
                    )}
                  </Menu>
                  <Button size="xs" variant="ghost" onPress={() => void editInStudio()}>
                    Edit in studio
                  </Button>
                </>
              )}
            />
          </CardFrame>
          <Show when={added()}>
            {(destination) => (
              <Inline spread>
                <Text tone="muted">{`Added to ${destination().name}.`}</Text>
                <Show when={destination().open}>
                  {(open) => (
                    <Button size="sm" variant="ghost" onPress={open()}>
                      Open
                    </Button>
                  )}
                </Show>
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
      <Show when={keeping()}>
        {(destination) => (
          <KeepUpdatedSheet
            nodeId={nodeId}
            workspaceId={workspaceId()}
            projectId={projectId()!}
            taskId={props.taskId}
            plan={props.plan}
            rows={supplied()!}
            destination={destination().name}
            onKeep={(plan) => place(destination(), plan)}
            onClose={() => setKeeping(undefined)}
          />
        )}
      </Show>
      <DashboardPanelHost
        session={studio() && { dashboardId: studio()!.dashboardId }}
        scope={studio()?.scope ?? homeTabScope('', workspaceId())}
        {...(studio()?.region ? { region: studio()!.region } : {})}
        returnLabel="Conversation"
        onClose={() => setStudio(undefined)}
      />
    </>
  )
}

/** The plugin regions of the workspace that would show this plan, after the Home tabs. A region checks a
 *  panel's sources and their field roles, so the plan's sources are described when the menu opens, and
 *  only when some region could take it. A failed description leaves the Home tabs alone. */
function RegionItems(props: {
  menu: MenuContext
  nodeId: string
  workspaceId: string
  plan: PanelPlan
  onSelect: (region: ReturnType<typeof regionsToAddTo>[number]) => void
}) {
  const [metadata, setMetadata] = createSignal<PanelPublicationMetadata>()
  if (panelRegionRegistry.entries().some((entry) => entry.when()))
    describePanelSources(props.nodeId, { workspaceId: props.workspaceId }, props.plan).then(setMetadata, () => {})
  const regions = () => {
    const described = metadata()
    return described ? regionsToAddTo(props.workspaceId, props.plan.view.kind, described) : []
  }
  return (
    <Show when={regions().length}>
      <Menu.Separator />
      <For each={regions()}>
        {(region) => (
          <Menu.Item context={props.menu} disabled={region.full} onSelect={() => props.onSelect(region)}>
            {region.label}
          </Menu.Item>
        )}
      </For>
    </Show>
  )
}
