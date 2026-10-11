import { createEffect, createSignal, on, onCleanup, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { activeNodeId, tasksOptions, writeJson } from '@acorn/plugin-api/client'
import { localActionRoute } from '../shared/changes/api'
import { Alert, Button, SectionHeader, Select, Stack, Text } from '@acorn/plugin-api/ui'
import { sameGitActionScope } from './launchWorkflow'

/** Pull and push go through the Changes tab's route, so they keep its checkout checks and before-push hook. */
export function TaskRemoteActions(props: { projectId: string }) {
  const tasks = createQuery(() => tasksOptions(true))
  const [taskId, setTaskId] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [feedback, setFeedback] = createSignal('')
  let generation = 0
  const selectTask = (id: string) => { generation++; setTaskId(id); setBusy(false); setFeedback('') }
  createEffect(on(() => `${activeNodeId()}:${props.projectId}`, () => selectTask(''), { defer: true }))
  onCleanup(() => { generation++ })
  const choices = () => (tasks.data ?? []).filter((task) => task.projectId === props.projectId && task.status === 'active')
  const selected = () => choices().find((task) => task.id === taskId())
  const run = async (action: 'pull' | 'push', rebase?: boolean) => {
    const nodeId = activeNodeId(), projectId = props.projectId, task = selected()
    if (!task || !sameGitActionScope(nodeId, projectId, props.projectId) || busy()) return
    const own = ++generation
    const current = () => own === generation && nodeId === activeNodeId() && projectId === props.projectId && task.id === taskId()
    setBusy(true); setFeedback('')
    try {
      const result = await writeJson<{ ok: boolean; reason?: string }>(localActionRoute(task.id, action), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action === 'pull' && rebase !== undefined ? { rebase } : {}),
      })
      if (current()) setFeedback(result.ok ? `${action === 'pull' ? 'Pulled' : 'Pushed'} ${task.title}.` : result.reason ?? 'Git refused the operation.')
    } catch (error) { if (current()) setFeedback(error instanceof Error ? error.message : String(error)) }
    finally { if (current()) setBusy(false) }
  }
  return <Stack gap="section">
    <SectionHeader>Task pull and push</SectionHeader>
    <Text>These run against the selected task's checkout, with the same checks and hooks as the Changes tab.</Text>
    <Select label="Target task" value={taskId()} options={[{ value: '', label: 'Choose a task' }, ...choices().map((task) => ({ value: task.id, label: task.title }))]} onChange={selectTask} />
    <Button disabled={!selected() || busy()} busy={busy()} onPress={() => void run('pull')}>Pull using Git setting</Button>
    <Button disabled={!selected() || busy()} onPress={() => void run('pull', false)}>Pull fast-forward only</Button>
    <Button disabled={!selected() || busy()} onPress={() => void run('pull', true)}>Pull with rebase</Button>
    <Button disabled={!selected() || busy()} onPress={() => void run('push')}>Push</Button>
    <Show when={feedback()}><Alert tone="warn">{feedback()}</Alert></Show>
  </Stack>
}
