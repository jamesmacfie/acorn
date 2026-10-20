import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, type JSX } from 'solid-js'
import type { DashboardDisplayRow } from '@acorn/dashboards-core/render'
import { planPartLabel } from '@acorn/dashboards-core/labels.ts'
import type { DashboardRun } from '@acorn/dashboards-core/plan.ts'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { BridgeAgentHint } from '@acorn/protocol/extensionBridge.ts'
import CardFrame from '@acorn/client-core/features/dashboards/CardFrame.tsx'
import RunPanel from '@acorn/client-core/features/dashboards/RunPanel.tsx'
import { PanelViewHostContext } from '@acorn/client-core/features/dashboards/views/host.ts'
import { Heading, Text } from '@acorn/client-core/kit/components/content'
import { IconButton } from '@acorn/client-core/kit/components/inputs'
import { Inline, Stack } from '@acorn/client-core/kit/components/layout'
import { Alert, Card } from '@acorn/client-core/kit/components/primitives.tsx'
import type { BrowserApi } from '../browser'
import type { DraftTarget } from '../localState'
import { CallFailure } from '../messages'
import type { BridgeClient } from './bridgeClient'
import { errorGuidance } from './guidance'
import { OpenInAcorn } from './OpenInAcorn'

// An agent's `panel_show` call, drawn live with the dashboard's own views and read only: links open in a
// new tab, and anything that opens in Acorn says so (docs/browser-extension/transcript.md § Panel cards).
// The host runs the plan. The card only names the call. Loaded with the first panel a conversation
// draws, so a conversation without one never loads the views.

// A busy agent hints several times a second, so a hint reruns a card at most this often.
const HINT_RERUN_MS = 5_000

// Where a row's press goes from the sidebar: a web address, which opens in a new tab, or somewhere in
// Acorn, which the sidebar can't open, so it offers Open in Acorn. Undefined leaves the row unpressable,
// as for a data source action, which runs only in Acorn.
type RowDestination = { url: string } | 'acorn'

// The desktop's verbs that open something in Acorn rather than act on the source.
const OPENS_IN_ACORN: ReadonlySet<string> = new Set(['openPane', 'openTask', 'openOverlay', 'navigate'])
const webAddress = (value: unknown): value is string => typeof value === 'string' && /^https?:\/\//.test(value)

// The desktop's press rules (`PublishedDashboardPanel`), where an address always opens in a tab.
function rowDestination(plan: PanelPlan, row: DashboardDisplayRow): RowDestination | undefined {
  const press = plan.actions?.press
  if (!press) {
    const action = row.action
    if (action?.verb === 'openUrl') return action.risk && action.risk !== 'read' ? 'acorn' : { url: action.url }
    return action && OPENS_IN_ACORN.has(action.verb) ? 'acorn' : undefined
  }
  if (press.kind === 'task') return row.taskId ? 'acorn' : undefined
  if (press.kind === 'link') {
    const value = row.values[press.column ?? '']
    return webAddress(value) ? { url: value } : undefined
  }
  const item = press.source
    ? row.recordItems?.find((candidate) => candidate.ref.sourceId === press.source)
    : row.recordItems?.[0]
  if (item?.action?.verb === 'openUrl') return { url: item.action.url }
  return item?.target || (item?.action && OPENS_IN_ACORN.has(item.action.verb)) ? 'acorn' : undefined
}

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
  const [inAcorn, setInAcorn] = createSignal(false)

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
  const press = (row: DashboardDisplayRow) => {
    const destination = rowDestination(fresh()!.plan, row)
    setInAcorn(destination === 'acorn')
    if (destination && destination !== 'acorn') openTab(destination.url)
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
                  >
                    <Show when={inAcorn()}>
                      <Alert tone="muted" actions={<OpenInAcorn href={props.href} opensLinks={props.opensLinks} />}>
                        That row opens in Acorn.
                      </Alert>
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
