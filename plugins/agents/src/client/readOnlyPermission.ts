import type { AgentConfigOption } from '../contract/wire.ts'

/** The harness's own read-only permission mode, when it advertises one: the option to set and the
 *  value that means read only. Inline chats and side questions both start in it. A harness without
 *  one answers nothing, and the caller falls back to asking in the prompt. */
export function readOnlyPermission(
  options: readonly AgentConfigOption[] | undefined,
): { optionId: string; value: string } | undefined {
  const option = options?.find((candidate) => candidate.category === 'permission')
  const value = option?.values.find((candidate) =>
    /read.?only/i.test(`${candidate.value} ${candidate.label} ${candidate.description ?? ''}`),
  )
  return option && value ? { optionId: option.id, value: value.value } : undefined
}
