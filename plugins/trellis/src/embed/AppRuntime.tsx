import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  Show,
  type Accessor,
  type Component,
  type JSX,
} from 'solid-js'
import { Alert, Button, CopyButton, Modal, ModalActions, ModalBody, Stack, Text } from '@acorn/plugin-api/ui'
import { createOpenUIRuntime, Renderer } from '@acorn/openui-solid'
import { BuiltinActionType, type ActionEvent } from '@openuidev/lang-core'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import { ROW_ACTION_TOOL, TASK_TOOL } from '../shared/library'
import { AppScopeContext, library, type AppPanelProps } from './bindings'
import { plainData, plainText } from './plainData'
import { keepState, readSavedState, type AppState, type SavedState } from './appState'

export type { AppPanelProps } from './bindings'
export type { AppState, SavedState } from './appState'

// One revision of an app, running, in any client (docs/agent-built-apps.md § What an app can reach). A
// program reaches nothing but the `AppHost` its client hands this. Everything that bounds a program is
// here, not in a host: values are copied to plain data before a host sees them, a link must be a web
// link and waits for the person to confirm it, a row action must be one the source offered and waits
// too, and an older revision acts on nothing. So no host ever calls a value a program handed it.

type RunRow = { id: string; values: Record<string, unknown>; actions?: NamedAction[] }
type NamedAction = { id: string; label: string; risk: 'read' | 'write' | 'execute' }
/** The part of a dashboard run the runtime reads. */
export type AppPlanRun = { rows: RunRow[]; diagnostics: { problems: { severity: string; message: string }[] } }

/** The whole of what a program reaches, as each client provides it. */
export type AppHost = {
  runPlan(name: string, inputs: Record<string, unknown>): Promise<{ plan: PanelPlan; run: AppPlanRun }>
  task(): Promise<{ id: string; title: string; branch: string | null }>
  /** Puts text in the conversation's message box. It never sends. */
  compose(text: string): Promise<{ ok: boolean; reason?: string }>
  /** Called only with a web link the person confirmed. */
  openUrl(url: string): void
  /** Absent where row actions don't run. `url` is a link the action answered with, to open next. */
  rowAction?(
    plan: string,
    row: string,
    action: string,
    inputs: Record<string, unknown>,
  ): Promise<{ outcome: string; url?: string }>
  loadState(): Promise<AppState>
  saveState(state: AppState): Promise<void>
}

type Confirm = { title: string; body: string; url?: string; answer: (ok: boolean) => void }

const isWebUrl = (url: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol)
  } catch {
    return false
  }
}
// The desktop and the browser can open a link. The terminal has no browser to hand it to, so its
// confirm offers to copy the link instead.
const canOpen = typeof window !== 'undefined' && typeof window.open === 'function'

export default function AppRuntime(props: {
  program: string
  /** The names of the revision's plans, which its Query and Panel may name. */
  plans: readonly string[]
  /** An older revision: drawn, but nothing in it acts, and it remembers nothing. */
  readOnly: boolean
  host: AppHost
  /** What the program reads as `$placement`. */
  placement: string
  /** Whether the app is on screen. It first draws when it first is, and its panels pause when it isn't. */
  active: Accessor<boolean>
  /** Draws a program's `Panel` with the client's own dashboard views. */
  Panel: Component<AppPanelProps>
  /** The saved state the client's views of this app share. Without it, this view reads its own. */
  savedState?: SavedState
  /** Asks the program's queries to run again: every one, or those of the named plans. */
  refreshes?: Accessor<{ plans?: string[] }>
  /** Wraps the program, but not the notices and confirms, such as in a card's capped frame. */
  frame?: (app: JSX.Element) => JSX.Element
}) {
  const host = props.host
  const saved = props.readOnly ? undefined : (props.savedState ?? readSavedState(() => host.loadState()))
  const seen = createMemo<boolean>((before) => before || props.active(), false)
  const [notice, setNotice] = createSignal('')
  const [confirm, setConfirm] = createSignal<Confirm>()
  const ask = (request: Omit<Confirm, 'answer'>) =>
    new Promise<boolean>((resolve) =>
      setConfirm({
        ...request,
        answer: (ok) => {
          setConfirm(undefined)
          resolve(ok)
        },
      }),
    )
  // Each plan's last run, with the inputs it ran with, so a row action names only a row it was shown.
  const lastRuns = new Map<string, { rows: RunRow[]; inputs: Record<string, unknown> }>()

  const openUrl = async (url: string) => {
    if (!isWebUrl(url))
      return setNotice(`This app tried to open a ${url.split(':')[0]}: link. Apps open only web links.`)
    if ((await ask({ title: 'Open this link?', body: 'The app wants to open:', url })) && canOpen) host.openUrl(url)
  }

  const runPlan = async (name: string, inputs: Record<string, unknown>) => {
    const { run } = await host.runPlan(name, inputs)
    const failed = run.diagnostics.problems.find((problem) => problem.severity === 'error')
    if (failed) throw new Error(failed.message)
    lastRuns.set(name, { rows: run.rows, inputs })
    return {
      rows: run.rows.map((row) => ({
        ...row.values,
        _id: row.id,
        _actions: (row.actions ?? []).map(({ id, label, risk }) => ({ id, label, risk })),
      })),
    }
  }

  // The row and action come from the plan's last run, never from the program, so a program can only
  // ask for an action the source offered on a row it was shown.
  const runRowAction = async (args: Record<string, unknown>) => {
    if (props.readOnly) throw new Error('An older revision is read only.')
    const rowAction = host.rowAction
    if (!rowAction) throw new Error('This action runs in the Acorn app.')
    const plan = plainText(args.plan)
    const last = lastRuns.get(plan)
    const row = last?.rows.find((candidate) => candidate.id === args.row)
    const action = row?.actions?.find((candidate) => candidate.id === args.action)
    if (!last || !row || !action) throw new Error('That row has no such action.')
    const title = String(row.values.title ?? row.id)
    if (
      !(await ask({
        title: `${action.label}?`,
        body: `${action.label} on ${title}. This can ${action.risk === 'read' ? 'open something' : 'change something'}.`,
      }))
    )
      throw new Error('The person declined.')
    const result = await rowAction(plan, row.id, action.id, last.inputs)
    if (result.url) await openUrl(result.url)
    return { outcome: result.outcome }
  }

  const tools = {
    ...Object.fromEntries(
      props.plans.map((name) => [
        name,
        (args: Record<string, unknown>) => runPlan(name, (plainData(args) ?? {}) as Record<string, unknown>),
      ]),
    ),
    [TASK_TOOL]: () => host.task(),
    [ROW_ACTION_TOOL]: runRowAction,
  }

  const onAction = (event: ActionEvent) => {
    if (props.readOnly) return
    if (event.type === BuiltinActionType.OpenUrl) void openUrl(plainText(event.params.url))
    if (event.type === BuiltinActionType.ContinueConversation) {
      const message = plainText(event.humanFriendlyMessage)
      const context = plainData(event.params.context)
      const text = context === undefined ? message : `${message}\n\n${JSON.stringify(context)}`
      void host.compose(text).then((result) => !result.ok && setNotice(result.reason ?? "Couldn't reach the agent."))
    }
  }

  // Created once the app is first seen and its saved state is read, under the Show that draws it, and
  // disposed with it.
  const Running = () => {
    const runtime = createOpenUIRuntime({
      program: () => props.program,
      library,
      tools,
      onAction,
      initialState: { $placement: props.placement },
    })
    if (saved) keepState(runtime, saved, (state) => host.saveState(state), setNotice)
    if (props.refreshes) createEffect(on(props.refreshes, (asked) => runtime.refresh(asked.plans), { defer: true }))
    return (
      <AppScopeContext.Provider
        value={{ plans: props.plans, readOnly: props.readOnly, active: props.active, Panel: props.Panel }}
      >
        <Renderer runtime={runtime} />
        {/* A plan that can't run says why, as a dashboard panel does, rather than drawing an empty list. */}
        <For each={runtime.errors().filter((error) => error.code === 'tool-error' || error.code === 'render-error')}>
          {(error) => <Alert tone="warn">{error.message}</Alert>}
        </For>
      </AppScopeContext.Provider>
    )
  }

  const app = (
    <Show when={seen() && (!saved || !saved.loading())}>
      <Running />
    </Show>
  )
  return (
    <Stack gap="row">
      {props.frame ? props.frame(app) : app}
      <Show when={notice()}>{(text) => <Alert tone="warn">{text()}</Alert>}</Show>
      <Show when={confirm()}>
        {(request) => (
          <Modal title={request().title} size="sm" onDismiss={() => request().answer(false)}>
            <ModalBody>
              <Text wrap>{request().body}</Text>
              <Show when={request().url}>
                {(url) => (
                  <Text emphasis="mono" wrap>
                    {url()}
                  </Text>
                )}
              </Show>
            </ModalBody>
            <ModalActions>
              <Button variant="ghost" onPress={() => request().answer(false)}>
                Cancel
              </Button>
              <Show
                when={!request().url || canOpen}
                fallback={<CopyButton text={() => request().url!} always onCopy={() => request().answer(false)} />}
              >
                <Button variant="solid" onPress={() => request().answer(true)}>
                  {request().url ? 'Open' : 'Confirm'}
                </Button>
              </Show>
            </ModalActions>
          </Modal>
        )}
      </Show>
    </Stack>
  )
}
