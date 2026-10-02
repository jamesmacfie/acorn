import { createSignal } from 'solid-js'
import type { ProjectBranches } from '@acorn/protocol/api.ts'
import { Field, Input, Select } from '../../kit/components/primitives'
import { Fold } from '../../kit/components/layout/Fold'
import { Stack } from '../../kit/components/layout/Stack'

export function BranchOptions(props: {
  branch: string
  error: string
  checking: boolean
  base: string
  branches?: ProjectBranches | null
  onBranch: (branch: string) => void
  onBase: (branch: string) => void
  onSubmit: () => void
}) {
  const [open, setOpen] = createSignal(false)
  return (
    <Fold label="Advanced" open={open() || !!props.error} onOpenChange={setOpen}>
      <Stack>
        <Field label="Branch name" error={props.error} hint={props.checking ? 'Checking worktree availability…' : undefined}>
          <Input value={props.branch} onInput={props.onBranch} onSubmit={props.onSubmit} />
        </Field>
        <Field label="Branch from" hint="Starts from the branch's last commit. Uncommitted changes do not carry over.">
          <Select value={props.base} onChange={props.onBase} options={[
            ...(props.branches?.tasks ?? []).map((task) => ({ value: task.branch, label: task.title, description: task.branch, group: 'Active tasks' })),
            ...(props.branches?.other ?? []).map((branch) => ({ value: branch.name, label: branch.name, group: 'Other local branches' })),
          ]} />
        </Field>
      </Stack>
    </Fold>
  )
}
