import { For, Show, createEffect, createSignal, on, onCleanup, type JSX } from 'solid-js'
import { planPartLabel } from '@acorn/dashboards-core/labels.ts'
import type { DashboardRun } from '@acorn/dashboards-core/plan.ts'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { BridgeAgentHint, BridgeResults } from '@acorn/protocol/extensionBridge.ts'
import AppRuntime, { type AppHost, type AppPanelProps } from '@acorn/plugin-trellis/embed/AppRuntime.tsx'
import CardFrame from '@acorn/client-core/features/dashboards/CardFrame.tsx'
import RunPanel from '@acorn/client-core/features/dashboards/RunPanel.tsx'
import { PanelViewHostContext } from '@acorn/client-core/features/dashboards/views/host.ts'
import { Text } from '@acorn/client-core/kit/components/content'
import { Inline, Stack } from '@acorn/client-core/kit/components/layout'
import { Alert, Button, Card } from '@acorn/client-core/kit/components/primitives.tsx'
import type { BrowserApi } from '../browser'
import type { DraftTarget } from '../localState'
import { CallFailure } from '../messages'
import type { BridgeClient } from './bridgeClient'
import { errorGuidance } from './guidance'
import { OpenInAcorn } from './OpenInAcorn'

// An agent's `app_show` call, running in the sidebar as the desktop's app card runs it
// (docs/browser-extension/transcript.md § App cards). Only the card showing the app's head acts; an
// older one collapses, and can draw its revision read only or restore it. The host reads the program
// and runs its plans; the card names the app, the revision, and a plan. Loaded with the first app a
// conversation draws, so a conversation without one never loads the runtime.

// A busy agent hints several times a second, so a hint reads the summary at most this often.
const HINT_REREAD_MS = 5_000

type AppView = BridgeResults['app.view']

const failure = (error: unknown) =>
  error instanceof CallFailure ? error : new CallFailure('node_error', String(error))
const webAddress = (url: string) => /^https?:\/\//.test(url)

export default function AppCard(props: {
  client: BridgeClient
  target: DraftTarget
  appId: string
  // The revision this call showed, and the note the agent gave it.
  revision: number
  note: string
  // The task's Apps pane in the desktop, where Publish to project is.
  href: string | null
  opensLinks: boolean
  hint: BridgeAgentHint | null
  reconnects: number
  tabs: BrowserApi['tabs']
  // Puts text in this conversation's message box.
  compose(text: string): Promise<{ ok: boolean; reason?: string }>
  // Counts the restores of any app card in this conversation, and tells them of this one's.
  restores: number
  restored(): void
  // The call's named line, drawn in place of the app when the host is too old to draw it.
  line: JSX.Element
}) {
  const { nodeId, taskId } = props.target
  const appId = props.appId
  const [view, setView] = createSignal<AppView>()
  const [problem, setProblem] = createSignal<CallFailure | null>(null)
  const [showOld, setShowOld] = createSignal(false)
  const [restoreError, setRestoreError] = createSignal('')

  const viewOf = (revision: number) => props.client.call({ op: 'app.view', nodeId, taskId, appId, revision })
  // Only the latest read's answer counts, so a slow one can't replace a newer summary.
  let asked = 0
  const read = async () => {
    const ask = ++asked
    try {
      const shown = await viewOf(props.revision)
      // A restore publishes an old revision's files anew. The card that showed them draws the result,
      // as on the desktop.
      const head = shown.summary.head
      const restored = shown.summary.revisions.find((entry) => entry.revision === head)?.restoredFrom === props.revision
      const drawn = restored && head !== props.revision ? await viewOf(head) : shown
      if (ask !== asked) return
      setView(drawn)
      setProblem(null)
    } catch (error) {
      if (ask === asked) setProblem(failure(error))
    }
  }

  let lastRead = 0
  let waiting: ReturnType<typeof setTimeout> | undefined
  const readNow = () => {
    clearTimeout(waiting)
    waiting = undefined
    lastRead = Date.now()
    void read()
  }
  const readSoon = () => {
    if (waiting) return
    const wait = lastRead + HINT_REREAD_MS - Date.now()
    if (wait <= 0) return readNow()
    waiting = setTimeout(readNow, wait)
  }
  onCleanup(() => clearTimeout(waiting))
  readNow()
  // A new revision arrives with the agent's next call, so the session's hint reads the summary again.
  createEffect(
    on(
      () => props.hint,
      (hint) => {
        if (hint?.nodeId === nodeId && (hint.missed || hint.sessions.includes(props.target.sessionId))) readSoon()
      },
      { defer: true },
    ),
  )
  createEffect(on(() => props.reconnects, readSoon, { defer: true }))
  createEffect(on(() => props.restores, readNow, { defer: true }))

  const head = () => view()?.summary.head ?? props.revision
  const current = () => view()?.revision === head()
  const label = () => {
    const shown = view()
    if (!shown) return ''
    const restoredFrom = shown.summary.revisions.find((entry) => entry.revision === shown.revision)?.restoredFrom
    return `${shown.summary.name} · v${shown.revision}${restoredFrom ? `, restored from v${restoredFrom}` : ''}`
  }

  // Kept until a restore succeeds, so a retry the Node already carried out makes no second revision.
  let restoreKey: string | undefined
  const restore = async () => {
    setRestoreError('')
    restoreKey ??= crypto.randomUUID()
    try {
      await props.client.call({ op: 'app.restore', nodeId, taskId, appId, revision: props.revision, key: restoreKey })
      restoreKey = undefined
      setShowOld(false)
      props.restored()
    } catch {
      setRestoreError(`Couldn't restore v${props.revision}. Try again.`)
    }
  }

  return (
    <Show
      when={problem()?.code !== 'bad_request'}
      fallback={
        <Stack gap="row">
          {props.line}
          <Text tone="muted" wrap>
            Update the Acorn CLI to see this app here.
          </Text>
        </Stack>
      }
    >
      <Show
        when={view()}
        fallback={
          <Stack gap="row">
            {props.line}
            <Show when={problem()}>
              {(shown) => (
                <p class="problem" role="alert">
                  {errorGuidance(shown())}
                </p>
              )}
            </Show>
          </Stack>
        }
      >
        {(shown) => (
          <Show
            when={shown().task}
            fallback={<Text tone="muted" wrap>{`${label()}. This task is archived, so the app isn't drawn.`}</Text>}
          >
            {(task) => (
              <Stack gap="row">
                <Show
                  when={current()}
                  fallback={
                    <Inline spread wrap>
                      <Text tone="muted" wrap>
                        {`v${props.revision}: ${props.note.replace(/([^.!?])$/, '$1.')} Replaced by v${head()}.`}
                      </Text>
                      <Inline gap="inline">
                        <Button size="sm" variant="ghost" onPress={() => setShowOld((open) => !open)}>
                          {showOld() ? `Hide v${props.revision}` : `Show v${props.revision}`}
                        </Button>
                        <Button size="sm" variant="ghost" onPress={() => void restore()}>
                          {`Restore v${props.revision}`}
                        </Button>
                      </Inline>
                    </Inline>
                  }
                >
                  <Inline spread wrap>
                    <Text emphasis="strong">{label()}</Text>
                    <OpenInAcorn href={props.href} opensLinks={props.opensLinks} />
                  </Inline>
                </Show>
                <Show when={restoreError()}>{(message) => <Alert tone="danger">{message()}</Alert>}</Show>
                <Show when={current() || showOld()}>
                  {/* Keyed on the revision, so a restore drawn in place starts the new program afresh. */}
                  <Show when={shown().revision} keyed>
                    {(revision) => (
                      <Running
                        client={props.client}
                        target={props.target}
                        appId={appId}
                        view={shown()}
                        revision={revision}
                        task={task()}
                        readOnly={!current()}
                        tabs={props.tabs}
                        compose={props.compose}
                      />
                    )}
                  </Show>
                </Show>
              </Stack>
            )}
          </Show>
        )}
      </Show>
    </Show>
  )
}

// One revision's program, with the sidebar's reach: its plans run by the host, the conversation's task
// and message box, a new tab, and the app's saved state. Row actions run only in Acorn.
function Running(props: {
  client: BridgeClient
  target: DraftTarget
  appId: string
  view: AppView
  revision: number
  task: NonNullable<AppView['task']>
  readOnly: boolean
  tabs: BrowserApi['tabs']
  compose(text: string): Promise<{ ok: boolean; reason?: string }>
}) {
  const { nodeId, taskId } = props.target
  const { appId, revision, task } = props
  const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const [visible, setVisible] = createSignal(false)
  const openTab = (url: string): boolean => {
    if (!webAddress(url)) return false
    void props.tabs.create({ url })
    return true
  }
  const host: AppHost = {
    runPlan: async (plan, inputs) => {
      // The runtime hands a host only plain data, so the inputs are JSON.
      const answer = await props.client.call({
        op: 'app.run',
        nodeId,
        taskId,
        appId,
        revision,
        plan,
        inputs: inputs as Record<string, never>,
        viewerZone,
      })
      // The host passes the run route's answer through unchanged.
      return { plan: answer.plan, run: answer.run as DashboardRun }
    },
    task: async () => task,
    compose: (text) => props.compose(text),
    openUrl: (url) => void openTab(url),
    loadState: async () => (await props.client.call({ op: 'app.state', nodeId, taskId, appId })).state ?? {},
    saveState: async (state) => {
      await props.client.call({
        op: 'app.state',
        nodeId,
        taskId,
        appId,
        state: state as Record<string, never>,
        key: crypto.randomUUID(),
      })
    },
  }
  const Panel = (panel: AppPanelProps) => <AppPanel {...panel} host={host} openTab={openTab} />
  return (
    <Card pad="sm">
      <AppRuntime
        program={props.view.program}
        plans={props.view.plans}
        readOnly={props.readOnly}
        host={host}
        placement="card"
        active={visible}
        Panel={Panel}
        frame={(app) => <CardFrame onVisible={setVisible}>{app}</CardFrame>}
      />
    </Card>
  )
}

// A program's Panel: the plan run by the host when it's on screen and again when its inputs change,
// drawn read only with the dashboard's own views. Links open in a new tab.
function AppPanel(props: AppPanelProps & { host: AppHost; openTab(url: string): boolean }) {
  const [answer, setAnswer] = createSignal<{ plan: PanelPlan; run: DashboardRun }>()
  const [problem, setProblem] = createSignal<CallFailure | null>(null)
  let asked = 0
  createEffect(
    on(
      () => (props.active ? JSON.stringify(props.inputs ?? {}) : undefined),
      (inputs) => {
        if (inputs === undefined) return
        const ask = ++asked
        props.host.runPlan(props.plan, props.inputs ?? {}).then(
          (next) => {
            if (ask !== asked) return
            setAnswer({ plan: next.plan, run: next.run as DashboardRun })
            setProblem(null)
          },
          (error: unknown) => ask === asked && setProblem(failure(error)),
        )
      },
    ),
  )
  return (
    <Stack gap="row">
      <Show when={problem()}>{(shown) => <Alert tone="warn">{errorGuidance(shown())}</Alert>}</Show>
      <Show when={answer()}>
        {(shown) => (
          <PanelViewHostContext.Provider value={{ openLink: props.openTab }}>
            <Stack gap="row">
              <Text emphasis="strong">{shown().plan.title}</Text>
              <RunPanel
                plan={shown().plan}
                run={shown().run}
                describe
                problems={
                  <For each={shown().run.diagnostics.problems}>
                    {(item) => (
                      <Alert tone="warn">{`${planPartLabel(shown().run.plan, item.path)}: ${item.message}`}</Alert>
                    )}
                  </For>
                }
              />
            </Stack>
          </PanelViewHostContext.Provider>
        )}
      </Show>
    </Stack>
  )
}
