import { createMemo, Show } from 'solid-js'
import { Badge, CodeBlock, CopyButton, EmptyState, Facts, Fold, Stack, Text, Toolbar, ToolbarSpacer } from '@acorn/plugin-api/ui/tree'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import type { WorkflowStepBodyProps } from '@acorn/plugin-workflows/contract/stepBody.ts'
import { formatBody, statusTone } from './ResponseView'

// An `http:request` workflow step's response, drawn in the run pane through `workflows:step-body`
// (docs/http-client.md § The workflow step). The step stored `{ status, headers, body }`
// (../server/workflowStep.ts), and the run pane hands that over as `output`.
//
// Props only. This entry reads no route and keeps no module state, so it shares nothing with the pane
// entries in the same worker, and each mount draws only the step it was given. The run pane keeps the
// header, Retry, and the error, and draws its own plain response if this plugin is off.

type StepResponse = { status: number; headers: [string, string][]; body: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The stored response, or `null` for anything else. The run pane's JSON is checked here, not trusted. */
export function readStepResponse(output: unknown): StepResponse | null {
  if (!isRecord(output) || typeof output.status !== 'number') return null
  const headers = Object.entries(isRecord(output.headers) ? output.headers : {})
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  return { status: output.status, headers, body: typeof output.body === 'string' ? output.body : '' }
}

export function HttpStepBodyApp(props: WorkflowStepBodyProps & { bridge: AcornBridge }) {
  const response = createMemo(() => readStepResponse(props.output))
  const body = createMemo(() => {
    const current = response()
    if (!current) return ''
    const contentType = current.headers.find(([name]) => name.toLowerCase() === 'content-type')?.[1] ?? ''
    return formatBody(current.body, contentType)
  })

  return (
    <Show when={response()} fallback={<Text tone="muted">{props.status === 'running' ? 'Sending…' : 'No response.'}</Text>}>
      {(current) => (
        <Stack gap="row">
          <Toolbar variant="bar" size="sm" ariaLabel="Response status">
            <Badge tone={statusTone(current().status)} shape="pill">{`${current().status}`}</Badge>
            <ToolbarSpacer />
            <Show when={body()}>
              <CopyButton always text={body()} onCopy={(text: string) => void props.bridge.ui.copy(text)} title="Copy body" />
            </Show>
          </Toolbar>
          <Show when={current().headers.length}>
            <Fold label="Headers" count={current().headers.length}>
              <Facts size="sm" grouping="rows" items={current().headers.map(([name, value]) => ({ label: name, value, mono: true }))} />
            </Fold>
          </Show>
          <Show when={body()} fallback={<EmptyState size="sm">The response has no body.</EmptyState>}>
            <CodeBlock size="sm" wrap maxHeight="block">{body()}</CodeBlock>
          </Show>
        </Stack>
      )}
    </Show>
  )
}
