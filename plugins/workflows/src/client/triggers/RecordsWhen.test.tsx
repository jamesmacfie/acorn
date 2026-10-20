import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowTriggerPreview, WorkflowTriggerView } from '../../shared/workflowTriggers'

// The shared query editor reads the Node's catalog. These tests are about what the trigger draws.
vi.mock('@acorn/plugin-api/ui/data-sources', () => ({
  SourceQueryEditor: () => <div>Query editor</div>,
  TypedBindingPicker: (props: { label: string }) => <div>{props.label}</div>,
}))

const { RecordMatchHistory, RecordsWhenFields } = await import('./RecordsWhen')

let dispose: (() => void) | undefined
const draw = (view: () => unknown) => {
  const host = document.createElement('div')
  document.body.append(host)
  dispose = render(view as never, host)
  return host
}
afterEach(() => {
  dispose?.()
  document.body.replaceChildren()
})

const preview: WorkflowTriggerPreview = {
  source: { label: 'Tasks', schema: { type: 'object' }, fields: [], incremental: false },
  records: [
    { title: 'Triage the inbox', wouldStart: true },
    { title: 'Triage the backlog', wouldStart: false },
  ],
  partial: 'The source caps how many matches it returns.',
}

describe('when records change', () => {
  it('says what the first check would start, and that a partial read is partial', () => {
    const host = draw(() => (
      <RecordsWhenFields
        workspaceId="workspace"
        projectId="project"
        draft={{ query: { kind: 'saved', queryId: 'q', bindings: {} }, change: { on: 'enters' } }}
        cadence={{ every: 300 }}
        preview={preview}
        previewing={false}
        onDraft={() => {}}
        onCadence={() => {}}
        onPreview={() => {}}
      />
    ))
    expect(host.textContent).toContain('Process current matches would start 1 of these 2.')
    expect(host.textContent).toContain('Triage the inbox · would start')
    expect(host.textContent).toContain('Read part of the results: The source caps how many matches it returns.')
    expect(host.textContent).toContain('Starts matching reads every match each check')
  })

  it('lists what the trigger started, with the last check', () => {
    const trigger = {
      when: { kind: 'records', query: { kind: 'saved', queryId: 'q', bindings: {} }, change: { on: 'new' } },
      lastCheck: { at: 1, started: 1, partial: 'The query stops at its record limit.' },
      matches: [
        {
          title: 'Triage the inbox',
          reason: 'new',
          state: 'completed',
          runStatus: 'done',
          taskId: 'task',
          runId: 'run',
          createdAt: 1,
        },
      ],
    } as unknown as WorkflowTriggerView
    const host = draw(() => <RecordMatchHistory trigger={trigger} onOpenRun={() => {}} />)
    expect(host.textContent).toContain('Last check read part of the results')
    expect(host.textContent).toContain('Triage the inbox · New · done')
  })
})
