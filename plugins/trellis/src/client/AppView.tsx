import { createSignal, For, Show } from 'solid-js'
import { Alert, Button, CopyButton, Modal, ModalActions, ModalBody, Stack, Text } from '@acorn/plugin-api/ui'
import { CardFrame } from '@acorn/plugin-api/ui/dashboards'
import { composeForAgent, taskById, writeJson } from '@acorn/plugin-api/client'
import { createOpenUIRuntime, Renderer } from '@acorn/openui-solid'
import { BuiltinActionType, type ActionEvent } from '@openuidev/lang-core'
import type { AppRevisionFiles } from '../shared/api'
import { ROW_ACTION_TOOL, TASK_TOOL } from '../shared/library'
import { AppHostContext, library } from './bindings'
import { plainData, plainText } from './plainData'
import { createSavedState, keepState } from './appState'

// One revision of an app, running (docs/agent-built-apps.md § What an app can reach). A program reaches
// nothing but what this hands it: its own plans, run under this device through the dashboard run route;
// the task it is drawn in; one row-action tool; and two actions. Each of those is checked here, and
// anything that leaves Acorn waits for the person to confirm it.

type RunRow = { id: string; values: Record<string, unknown>; records?: unknown[]; actions?: NamedAction[] }
type NamedAction = { id: string; label: string; risk: 'read' | 'write' | 'execute' }
type Confirm = { title: string; body: string; url?: string; answer: (ok: boolean) => void }

const isWebUrl = (url: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol)
  } catch {
    return false
  }
}
// The desktop hands a window.open to the owner's browser. The terminal has no browser to hand it to,
// so its confirm offers to copy the link instead.
const canOpen = typeof window !== 'undefined' && typeof window.open === 'function'

export default function AppView(props: {
  appId: string
  taskId: string
  workspaceId: string
  files: AppRevisionFiles
  nodeId: string
  readOnly: boolean
  placement: 'card' | 'pane'
}) {
  const inCard = props.placement === 'card'
  // A card's plans first run when it is first on screen, so a long conversation reads only what is
  // seen. A pane is on screen.
  const [visible, setVisible] = createSignal(!inCard)
  const [seen, setSeen] = createSignal(!inCard)
  // An older revision is read only and remembers nothing.
  const saved = props.readOnly ? undefined : createSavedState(props.nodeId, props.appId)
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
  const lastRows = new Map<string, RunRow[]>()

  const openUrl = async (url: string) => {
    if (!isWebUrl(url))
      return setNotice(`This app tried to open a ${url.split(':')[0]}: link. Apps open only web links.`)
    if (await ask({ title: 'Open this link?', body: 'The app wants to open:', url }))
      if (canOpen) window.open(url, '_blank', 'noopener,noreferrer')
  }

  const runPlan = async (name: string, inputs: Record<string, unknown>) => {
    const run = await writeJson<{ rows: RunRow[]; diagnostics: { problems: { severity: string; message: string }[] } }>(
      '/v1/core/dashboards/run',
      {
        method: 'POST',
        nodeId: props.nodeId,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation: 'run',
          scope: { workspaceId: props.workspaceId },
          target: { kind: 'draft', content: props.files.plans[name] },
          mode: 'execution',
          viewerZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          inputs,
        }),
      },
    )
    const failed = run.diagnostics.problems.find((problem) => problem.severity === 'error')
    if (failed) throw new Error(failed.message)
    lastRows.set(name, run.rows)
    return {
      rows: run.rows.map((row) => ({
        ...row.values,
        _id: row.id,
        _actions: (row.actions ?? []).map(({ id, label, risk }) => ({ id, label, risk })),
      })),
    }
  }

  // The row and action come from the host's own last run of the plan, never from the program, so a
  // program can only ask for an action the source offered on a row it was shown.
  const runRowAction = async (args: Record<string, unknown>) => {
    if (props.readOnly) throw new Error('An older revision is read only.')
    const row = lastRows.get(plainText(args.plan))?.find((candidate) => candidate.id === args.row)
    const action = row?.actions?.find((candidate) => candidate.id === args.action)
    const record = row?.records?.[0]
    if (!row || !action || !record) throw new Error('That row has no such action.')
    const title = String(row.values.title ?? row.id)
    if (
      !(await ask({
        title: `${action.label}?`,
        body: `${action.label} on ${title}. This can ${action.risk === 'read' ? 'open something' : 'change something'}.`,
      }))
    )
      throw new Error('The person declined.')
    const result = await writeJson<{ outcome: string; action?: { verb: string; url?: string } }>(
      '/v1/core/data-sources/act',
      {
        method: 'POST',
        nodeId: props.nodeId,
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ ref: record, actionId: action.id, confirmedRisk: action.risk }),
      },
    )
    if (result.outcome === 'ready' && result.action?.verb === 'openUrl' && result.action.url)
      await openUrl(result.action.url)
    return { outcome: result.outcome }
  }

  const tools = {
    ...Object.fromEntries(
      Object.keys(props.files.plans).map((name) => [
        name,
        (args: Record<string, unknown>) => runPlan(name, (plainData(args) ?? {}) as Record<string, unknown>),
      ]),
    ),
    [TASK_TOOL]: async () => {
      const task = taskById(props.taskId)
      return { id: props.taskId, title: task?.title ?? '', branch: task?.branch ?? null }
    },
    [ROW_ACTION_TOOL]: runRowAction,
  }

  const onAction = (event: ActionEvent) => {
    if (props.readOnly) return
    if (event.type === BuiltinActionType.OpenUrl) void openUrl(plainText(event.params.url))
    if (event.type === BuiltinActionType.ContinueConversation) {
      const message = plainText(event.humanFriendlyMessage)
      const context = plainData(event.params.context)
      const text = context === undefined ? message : `${message}\n\n${JSON.stringify(context)}`
      void composeForAgent(props.taskId, text).then(
        (result) => !result.ok && setNotice(result.reason ?? "Couldn't reach the agent."),
      )
    }
  }

  // Created once the app is first seen and its saved state is read, under the Show that draws it, and
  // disposed with it.
  const Running = () => {
    const runtime = createOpenUIRuntime({
      program: () => props.files.program,
      library,
      tools,
      onAction,
      initialState: { $placement: props.placement },
    })
    if (saved) keepState(runtime, saved, setNotice)
    return (
      <AppHostContext.Provider
        value={{
          appId: props.appId,
          workspaceId: props.workspaceId,
          plans: props.files.plans,
          readOnly: props.readOnly,
          active: visible,
        }}
      >
        <Renderer runtime={runtime} />
        {/* A plan that can't run says why, as a dashboard panel does, rather than drawing an empty list. */}
        <For each={runtime.errors().filter((error) => error.code === 'tool-error' || error.code === 'render-error')}>
          {(error) => <Alert tone="warn">{error.message}</Alert>}
        </For>
      </AppHostContext.Provider>
    )
  }

  const app = (
    <Show when={seen() && (!saved || !saved.loading())}>
      <Running />
    </Show>
  )
  return (
    <Stack gap="row">
      {inCard ? (
        <CardFrame
          onVisible={(next) => {
            setVisible(next)
            if (next) setSeen(true)
          }}
        >
          {app}
        </CardFrame>
      ) : (
        app
      )}
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
