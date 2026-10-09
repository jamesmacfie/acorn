import { createSignal, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { activeNodeId, tasksOptions, writeJson } from '@acorn/plugin-api/client'
import { changesRemoteRoute } from '@acorn/plugin-changes/contract/remote.ts'
import { Alert, Button, SectionHeader, Select, Stack, Text } from '@acorn/plugin-api/ui'
import { sameGitActionScope } from './launchWorkflow'

/** Task checkout writes stay with Changes, including its before-push hook. */
export function TaskRemoteActions(props: { projectId: string }) {
  const tasks = createQuery(() => tasksOptions(true))
  const [taskId, setTaskId] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [feedback, setFeedback] = createSignal('')
  const choices = () => (tasks.data ?? []).filter((task) => task.projectId === props.projectId && task.status === 'active')
  const selected = () => choices().find((task) => task.id === taskId())
  const run = async (action: 'pull' | 'push', rebase?: boolean) => {
    const nodeId = activeNodeId(), projectId = props.projectId, task = selected()
    if (!task || !sameGitActionScope(nodeId, projectId, props.projectId) || busy()) return
    setBusy(true); setFeedback('')
    try {
      const result = await writeJson<{ ok: boolean; reason?: string }>(changesRemoteRoute(task.id, action), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action === 'pull' && rebase !== undefined ? { rebase } : {}),
      })
      if (sameGitActionScope(nodeId, projectId, props.projectId)) setFeedback(result.ok ? `${action === 'pull' ? 'Pulled' : 'Pushed'} ${task.title}.` : result.reason ?? 'Changes refused the operation.')
    } catch (error) { if (sameGitActionScope(nodeId, projectId, props.projectId)) setFeedback(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return <Stack gap="section">
    <SectionHeader>Task pull and push</SectionHeader>
    <Text>Changes runs these actions against the selected task checkout and applies its hooks.</Text>
    <Select label="Target task" value={taskId()} options={[{ value: '', label: 'Choose a task' }, ...choices().map((task) => ({ value: task.id, label: task.title }))]} onChange={setTaskId} />
    <Button disabled={!selected() || busy()} busy={busy()} onPress={() => void run('pull')}>Pull using Git setting</Button>
    <Button disabled={!selected() || busy()} onPress={() => void run('pull', false)}>Pull fast-forward only</Button>
    <Button disabled={!selected() || busy()} onPress={() => void run('pull', true)}>Pull with rebase</Button>
    <Button disabled={!selected() || busy()} onPress={() => void run('push')}>Push</Button>
    <Show when={feedback()}><Alert tone="warn">{feedback()}</Alert></Show>
  </Stack>
}
