// The transcript card for core's run_script tool: the program, folded, and each tool it called with
// the outcome, so a reader sees what ran without opening the raw result.
import { createMemo, For, Show } from 'solid-js'
import type { AgentToolCardProps } from '@acorn/protocol/extensionPoints.ts'
import { Card, CodeBlock, Fold, Stack, Text } from '@acorn/plugin-api/ui'

type ScriptAnswer = {
  ok?: boolean
  error?: { message?: string; line?: number }
  calls?: { tool: string; ok: boolean; error?: string }[]
}

// Providers return plain JSON or the MCP content envelope around it. A pending call, a failed one, or
// a result the MCP cap cut short doesn't parse.
function parse(text: string | undefined): Record<string, unknown> | null {
  if (!text) return null
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const content = (parsed as { content?: unknown }).content
    if (Array.isArray(content)) {
      for (const part of content) {
        const nested = parse((part as { text?: string })?.text)
        if (nested) return nested
      }
    }
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

export function RunScriptToolCard(props: AgentToolCardProps) {
  const code = createMemo(() => {
    const value = parse(props.tool.input)?.code
    return typeof value === 'string' ? value : undefined
  })
  const answer = createMemo(() => parse(props.tool.output) as ScriptAnswer | null)
  const calls = () => answer()?.calls ?? []
  const label = () => {
    const result = answer()
    if (!result) return props.tool.status === 'failed' ? "The script didn't run" : 'Running a script'
    const count = `${calls().length} tool ${calls().length === 1 ? 'call' : 'calls'}`
    return result.ok ? `Ran a script with ${count}` : `The script failed after ${count}`
  }
  const failure = () => {
    const error = answer()?.error
    return error?.message ? `${error.message}${error.line ? ` (line ${error.line})` : ''}` : undefined
  }
  return (
    <Card>
      <Stack gap="row">
        <Text emphasis="strong">{label()}</Text>
        <Show when={failure()}>{(message) => <Text wrap>{message()}</Text>}</Show>
        <For each={calls()}>
          {(call) => (
            <Text emphasis="muted">
              {call.tool}: {call.ok ? 'ok' : (call.error ?? 'failed')}
            </Text>
          )}
        </For>
        <Show when={code()}>
          {(program) => (
            <Fold label="Program" level="sub">
              <CodeBlock wrap maxHeight="block">
                {program()}
              </CodeBlock>
            </Fold>
          )}
        </Show>
        <Show when={!answer() && props.tool.output}>
          <CodeBlock wrap maxHeight="block">
            {props.tool.output}
          </CodeBlock>
        </Show>
      </Stack>
    </Card>
  )
}
