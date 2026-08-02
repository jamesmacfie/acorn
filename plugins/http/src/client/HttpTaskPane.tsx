// The API task pane: the same panel as the rail Source, scoped to this task. Requests created here
// stay with the task (an ad-hoc request) until you file them into the repo's tree, and the
// {{worktree}} / {{branch}} / {{taskId}} builtins resolve against it — which is the point, since
// every task worktree runs its own dev server on its own port.
import type { Task } from '@acorn/client-core/queries.ts'
import HttpPanel from './HttpPanel'
import './http.css'

export default function HttpTaskPane(props: { task: Task }) {
  return <HttpPanel owner={props.task.repoOwner} repo={props.task.repoName} taskId={props.task.id} />
}
