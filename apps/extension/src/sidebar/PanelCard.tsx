import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, type JSX } from 'solid-js'
import type { DashboardDisplayRow } from '@acorn/dashboards-core/render'
import { planPartLabel } from '@acorn/dashboards-core/labels.ts'
import type { DashboardRun, PlanRecordItem } from '@acorn/dashboards-core/plan.ts'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { BridgeAgentHint } from '@acorn/protocol/extensionBridge.ts'
import CardFrame from '@acorn/client-core/features/dashboards/CardFrame.tsx'
import RunPanel from '@acorn/client-core/features/dashboards/RunPanel.tsx'
import { PanelViewHostContext } from '@acorn/client-core/features/dashboards/views/host.ts'
import { Heading, Text } from '@acorn/client-core/kit/components/content'
import { IconButton } from '@acorn/client-core/kit/components/inputs'
import { Inline, Stack } from '@acorn/client-core/kit/components/layout'
import { Alert, Button, Card } from '@acorn/client-core/kit/components/primitives.tsx'
import type { BrowserApi } from '../browser'
import type { DraftTarget } from '../localState'
import { CallFailure } from '../messages'
import type { BridgeClient } from './bridgeClient'
import { errorGuidance } from './guidance'
import { OpenInAcorn } from './OpenInAcorn'
import { actionConfirm, nextStep, rowActions } from './rowActions'

// An agent's `panel_show` call, drawn live with the dashboard's own views: links open in a new tab, a
// row's data source actions run after the desktop's confirm, and anything that opens in Acorn says so
// (docs/browser-extension/transcript.md § Panel cards). The host runs the plan. The card only names the
// call and, for an action, the row and action. Loaded with the first panel a conversation
// draws, so a conversation without one never loads the views.

// A busy agent hints several times a second, so a hint reruns a card at most this often.
const HINT_RERUN_MS = 5_000

// Where a row's press goes from the sidebar: a web address, which opens in a new tab, or somewhere in
// Acorn, which the sidebar can't open, so it offers Open in Acorn. Undefined leaves the row unpressable,
// as for a row's own `runNodeAction`, which only the desktop calls.
type RowDestination = { url: string } | 'acorn'
type OpenReference = NonNullable<NonNullable<PanelPlan['actions']>['press']>
type RowButton = NonNullable<PanelPlan['actions']>['buttons'][number]

// The desktop's verbs that open something in Acorn rather than act on the source.
const OPENS_IN_ACORN: ReadonlySet<string> = new Set(['openPane', 'openTask', 'openOverlay', 'navigate'])
const webAddress = (value: unknown): value is string => typeof value === 'string' && /^https?:\/\//.test(value)

// The desktop's press rules (`PublishedDashboardPanel`), where an address always opens in a tab.
function rowDestination(plan: PanelPlan, row: DashboardDisplayRow): RowDestination | undefined {
  const press = plan.actions?.press
  if (press) return referenceDestination(press, row)
  const action = row.action
  if (action?.verb === 'openUrl') return action.risk && action.risk !== 'read' ? 'acorn' : { url: action.url }
  return action && OPENS_IN_ACORN.has(action.verb) ? 'acorn' : undefined
}

function referenceDestination(reference: OpenReference, row: DashboardDisplayRow): RowDestination | undefined {
  if (reference.kind === 'task') return row.taskId ? 'acorn' : undefined
  if (reference.kind === 'link') {
    const value = row.values[reference.column ?? '']
    return webAddress(value) ? { url: value } : undefined
  }
  return itemDestination(
    reference.source
      ? row.recordItems?.find((candidate) => candidate.ref.sourceId === reference.source)
      : row.recordItems?.[0],
  )
}

function itemDestination(item: PlanRecordItem | undefined): RowDestination | undefined {
  if (item?.action?.verb === 'openUrl') return { url: item.action.url }
  return item?.target || (item?.action && OPENS_IN_ACORN.has(item.action.verb)) ? 'acorn' : undefined
}

const rowTitle = (row: DashboardDisplayRow) =>
  typeof row.values.title === 'string' && row.values.title ? row.values.title : row.id

// A source that couldn't answer. The card keeps the last answer that had its data, greyed out, as the
// desktop's panel does.
const sourceFailed = (run: DashboardRun) =>
  run.diagnostics.problems.some((problem) => problem.severity === 'error' && problem.failure)

export default function PanelCard(props: {
  client: BridgeClient
  target: DraftTarget
  toolId: string
  title: string
  // The conversation in the desktop, where Add to dashboard and Edit in studio are.
  href: string | null
  opensLinks: boolean
  hint: BridgeAgentHint | null
  reconnects: number
  tabs: BrowserApi['tabs']
  // The call's named line, drawn in place of the panel when the host is too old to run it.
  line: JSX.Element
}) {
  const { nodeId, sessionId } = props.target
  const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const [fresh, setFresh] = createSignal<{ plan: PanelPlan; run: DashboardRun }>()
  const [lastGood, setLastGood] = createSignal<DashboardRun>()
  const [problem, setProblem] = createSignal<CallFailure | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [visible, setVisible] = createSignal(false)
  // What the last press did, when it says something, and whether it offers Open in Acorn.
  const [notice, setNotice] = createSignal<{ text: string; inAcorn?: true }>()
  // A press waiting for the person: an action that can change something, or a link it answered with.
  const [confirm, setConfirm] = createSignal<{ text: string; label: string; go(): void }>()
  const act = rowActions(props.client, nodeId)

  // Only the latest read's answer counts, so a slow one can't replace a newer panel.
  let asked = 0
  const read = async () => {
    const ask = ++asked
    setBusy(true)
    try {
      const answer = await props.client.call({ op: 'panel.run', nodeId, sessionId, toolId: props.toolId, viewerZone })
      if (ask !== asked) return
      // The host passes the run route's answer through unchanged.
      const run = answer.run as DashboardRun
      setFresh({ plan: answer.plan, run })
      if (!sourceFailed(run)) setLastGood(run)
      setProblem(null)
    } catch (error) {
      if (ask === asked) setProblem(error instanceof CallFailure ? error : new CallFailure('node_error', String(error)))
    } finally {
      if (ask === asked) setBusy(false)
    }
  }

  let lastRun = 0
  let waiting: ReturnType<typeof setTimeout> | undefined
  const runNow = () => {
    clearTimeout(waiting)
    waiting = undefined
    lastRun = Date.now()
    void read()
  }
  // Runs while on screen, at most once every HINT_RERUN_MS. A card scrolled away sends nothing.
  const runSoon = () => {
    if (!visible() || waiting) return
    const wait = lastRun + HINT_RERUN_MS - Date.now()
    if (wait <= 0) return runNow()
    waiting = setTimeout(() => {
      waiting = undefined
      if (visible()) runNow()
    }, wait)
  }
  onCleanup(() => clearTimeout(waiting))

  const supplied = () => fresh()?.plan.sources[0]?.reference.kind === 'supplied'
  createEffect(on(visible, (shown) => shown && runSoon()))
  createEffect(
    on(
      () => props.hint,
      (hint) => {
        // Rows the agent supplied never change, and can be large, so a hint doesn't read them again.
        if (hint?.nodeId === nodeId && (hint.missed || hint.sessions.includes(sessionId)) && !supplied()) runSoon()
      },
      { defer: true },
    ),
  )
  createEffect(on(() => props.reconnects, runSoon, { defer: true }))

  const stale = createMemo(() => !!fresh() && sourceFailed(fresh()!.run) && !!lastGood())
  const shown = () => (stale() ? lastGood() : fresh()?.run)

  const openTab = (url: string): boolean => {
    if (!webAddress(url)) return false
    void props.tabs.create({ url })
    return true
  }
  const go = (destination: RowDestination | undefined) => {
    setConfirm(undefined)
    setNotice(
      destination === 'acorn'
        ? { text: 'That row opens in Acorn.', inAcorn: true }
        : destination
          ? undefined
          : { text: 'That row has nowhere to open.' },
    )
    if (destination && destination !== 'acorn') openTab(destination.url)
  }
  const press = (row: DashboardDisplayRow) => go(rowDestination(fresh()!.plan, row))

  // The row and action the person pressed, as this card's run drew them. The host finds both again in a
  // fresh run, and the card runs again after, so the row shows what the action changed.
  const runAction = async (row: DashboardDisplayRow, action: { id: string; risk: 'read' | 'write' | 'execute' }) => {
    setConfirm(undefined)
    setNotice(undefined)
    try {
      const result = await act({ kind: 'panel', sessionId, toolId: props.toolId }, row.id, action)
      runNow()
      const next = nextStep(result)
      if (next === 'acorn') setNotice({ text: 'That action continues in Acorn.', inAcorn: true })
      else if (next) setConfirm({ text: `Open this link? ${next.url}`, label: 'Open', go: () => go(next) })
      else setNotice({ text: result.outcome === 'done' ? 'Action completed.' : 'This action no longer applies.' })
    } catch (error) {
      setNotice({
        text: errorGuidance(error instanceof CallFailure ? error : new CallFailure('node_error', String(error))),
      })
    }
  }
  const pressButton = (row: DashboardDisplayRow, button: RowButton) => {
    if (button.kind === 'open') return go(referenceDestination(button.reference, row))
    if (button.kind === 'createTask') return go('acorn')
    const named = row.actions?.find((action) => action.id === button.actionId)
    if (!named) return setNotice({ text: 'This action no longer applies.' })
    const text = actionConfirm(named.label, rowTitle(row), named.risk)
    if (!text) return void runAction(row, named)
    setNotice(undefined)
    setConfirm({ text, label: named.label, go: () => void runAction(row, named) })
  }

  return (
    <Show
      when={problem()?.code !== 'bad_request'}
      fallback={
        <Stack gap="row">
          {props.line}
          <Text tone="muted" wrap>
            Update the Acorn CLI to see this panel here.
          </Text>
        </Stack>
      }
    >
      <Card pad="sm">
        <Stack gap="row">
          <Inline spread>
            <Heading level={3}>{props.title}</Heading>
            <Inline gap="none">
              <Show when={!supplied()}>
                <IconButton icon="refresh-cw" label={`Refresh ${props.title}`} spin={busy()} onPress={runNow} />
              </Show>
              <OpenInAcorn href={props.href} opensLinks={props.opensLinks} iconOnly />
            </Inline>
          </Inline>
          <Show when={problem()}>
            {(failure) => (
              <p class="problem" role="alert">
                {errorGuidance(failure())}
              </p>
            )}
          </Show>
          <PanelViewHostContext.Provider value={{ openLink: openTab }}>
            <CardFrame onVisible={setVisible}>
              <Show when={fresh() || !problem()}>
                {/* Each of the run's notes on a line of its own. */}
                <Stack gap="row">
                  <RunPanel
                    plan={fresh()?.plan}
                    run={shown()}
                    stale={stale()}
                    describe
                    problems={
                      <For each={fresh()?.run.diagnostics.problems ?? []}>
                        {(item) => (
                          <Alert tone="warn">{`${planPartLabel(fresh()!.run.plan, item.path)}: ${item.message}`}</Alert>
                        )}
                      </For>
                    }
                    canActivate={(row) => !!fresh() && rowDestination(fresh()!.plan, row) !== undefined}
                    onActivate={press}
                    onButton={pressButton}
                    onOpenRecord={(_, item) => go(itemDestination(item))}
                  >
                    <Show when={notice()}>
                      {(shown) => (
                        <Alert
                          tone="muted"
                          actions={
                            shown().inAcorn ? (
                              <OpenInAcorn href={props.href} opensLinks={props.opensLinks} />
                            ) : undefined
                          }
                        >
                          {shown().text}
                        </Alert>
                      )}
                    </Show>
                    <Show when={confirm()}>
                      {(asked) => (
                        <Alert
                          tone="warn"
                          actions={
                            <>
                              <Button size="sm" variant="ghost" onPress={() => setConfirm(undefined)}>
                                Cancel
                              </Button>
                              <Button size="sm" variant="solid" onPress={() => asked().go()}>
                                {asked().label}
                              </Button>
                            </>
                          }
                        >
                          {asked().text}
                        </Alert>
                      )}
                    </Show>
                  </RunPanel>
                </Stack>
              </Show>
            </CardFrame>
          </PanelViewHostContext.Provider>
        </Stack>
      </Card>
    </Show>
  )
}
