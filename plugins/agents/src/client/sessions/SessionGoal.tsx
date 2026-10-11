import { createEffect, createSignal, on, onCleanup, Show } from 'solid-js'
import { Alert, Button, Field, Inline, Input, Modal, Stack, Text } from '@acorn/plugin-api/ui'
import { activeNodeId, latestSignal } from '@acorn/plugin-api/client'
import type { AgentSession } from '../../contract/wire.ts'
import { managedAgentApi } from './managedClient'
import { managedAgentStore } from './managedStore'
import { consumeSessionGoalEditor } from './sessionGoalCommand'

export default function SessionGoal(props: { session: AgentSession; openToken: number; onUpdate(session: AgentSession): void }) {
  const [open, setOpen] = createSignal(false)
  const [objective, setObjective] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  let mounted = true
  const goalAction = latestSignal()
  onCleanup(() => { mounted = false; goalAction.abort() })
  createEffect(on(() => [activeNodeId(), props.session.id] as const, () => {
    goalAction.abort()
    setOpen(false)
    setBusy(false)
    setError('')
  }, { defer: true }))
  const eligible = () => props.session.kind === 'interactive' && props.session.controller === 'acorn'
    && !props.session.archivedAt
  const showEditor = () => {
    setObjective(props.session.goal?.objective ?? '')
    setError('')
    setOpen(true)
  }
  createEffect(on(() => props.openToken, (token) => { if (token) showEditor() }))
  createEffect(() => {
    if (eligible() && consumeSessionGoalEditor(props.session.id)) showEditor()
  })

  const update = async (action: 'set' | 'clear' | 'resume') => {
    const sessionId = props.session.id
    const owner = managedAgentStore.captureRead(sessionId)
    const signal = goalAction.next()
    const ownsView = () => mounted && !signal.aborted && props.session.id === sessionId && owner.current()
    setBusy(true)
    setError('')
    try {
      const updated = action === 'resume' ? await managedAgentApi.resumeGoal(sessionId, owner)
        : await managedAgentApi.setGoal(sessionId, action === 'clear' ? null : objective().trim(), owner)
      if (!ownsView() || updated.id !== sessionId) return
      props.onUpdate(updated)
      setOpen(false)
    } catch (caught) {
      if (ownsView()) setError(caught instanceof Error ? caught.message : 'Unable to update the goal.')
    } finally {
      if (ownsView()) setBusy(false)
    }
  }

  return <>
    <Show when={eligible()}>
      <Show when={props.session.goal}>
        {(goal) => <Stack gap="row">
          <Inline>
            <Text wrap>Goal: {goal().objective}</Text>
            <Text emphasis="muted">{goal().status} · {goal().continuations}/8 continuations</Text>
            <Show when={goal().status === 'paused'}><Button size="sm" onPress={() => void update('resume')}>Resume</Button></Show>
            <Button size="sm" variant="bare" onPress={showEditor}>Edit</Button>
            <Button size="sm" variant="bare" onPress={() => void update('clear')}>Clear</Button>
          </Inline>
          <Show when={goal().verdict}><Text emphasis="muted" wrap>{goal().verdict?.reason}</Text></Show>
        </Stack>}
      </Show>
    </Show>
    <Show when={error()}><Alert>{error()}</Alert></Show>
    <Show when={open()}>
      <Modal title="Set session goal" size="sm" onDismiss={() => setOpen(false)}>
        <Modal.Body>
          <Field label="Completion condition">
            <Input value={objective()} maxLength={2_000} onInput={setObjective}
              onSubmit={() => { if (objective().trim()) void update('set') }} />
          </Field>
        </Modal.Body>
        <Modal.Actions>
          <Button variant="ghost" onPress={() => setOpen(false)}>Cancel</Button>
          <Button variant="solid" disabled={!objective().trim()} busy={busy()} onPress={() => void update('set')}>Set goal</Button>
        </Modal.Actions>
      </Modal>
    </Show>
  </>
}
