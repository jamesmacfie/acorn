import { createSignal, Show } from 'solid-js'
import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../contract/wire.ts'
import type { SessionSummary } from '../../shared/sessionSummary'

const summarize = vi.fn<(...args: unknown[]) => Promise<SessionSummary>>()
vi.mock('./managedClient', () => ({ managedAgentApi: { summarize } }))
vi.mock('@acorn/plugin-api/client', async (original) => ({
  ...(await original<typeof import('@acorn/plugin-api/client')>()),
  activeNodeId: () => 'summary-node',
  modelBackendsOptions: () => ({
    queryKey: ['summary-backends'],
    initialData: {
      backends: [{ id: 'harness:codex', label: 'Codex', kind: 'harness', models: [], defaultModelId: '' }],
    },
  }),
  prefsOptions: () => ({ queryKey: ['summary-prefs'], initialData: {} }),
}))
const { default: SessionSummaryModal } = await import('./SessionSummaryModal')
let dispose: (() => void) | undefined
let host: HTMLElement

afterEach(() => {
  dispose?.()
  host?.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  summarize.mockReset()
})
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent?.trim() === text)!
const mount = () => {
  host = document.createElement('div')
  document.body.append(host)
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } })
  const [open, setOpen] = createSignal(true)
  dispose = render(
    () => (
      <QueryClientProvider client={client}>
        <Show when={open()}>
          <SessionSummaryModal
            session={{ id: 'summary-session', title: 'A running agent' } as AgentSession}
            onDismiss={() => setOpen(false)}
          />
        </Show>
      </QueryClientProvider>
    ),
    host,
  )
}

describe('the run summary dialog', () => {
  it('expands while generating, includes extra context, and copies the raw Markdown', async () => {
    let finish!: (value: SessionSummary) => void
    summarize.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    mount()
    expect(document.querySelector('[role="dialog"]')?.getAttribute('data-size')).toBe('md')
    expect(document.querySelector('[aria-label="Model for the summary"]')).toBeTruthy()
    const context = document.querySelector<HTMLTextAreaElement>('textarea')!
    context.value = 'Focus on the remaining work'
    context.dispatchEvent(new Event('input', { bubbles: true }))
    button('Generate Markdown').click()
    expect(document.querySelector('[role="dialog"]')?.getAttribute('data-size')).toBe('wide')
    expect(document.querySelector('[role="status"][aria-label="Generating summary"]')).toBeTruthy()
    expect(summarize).toHaveBeenCalledWith(
      'summary-session',
      {
        backendId: 'harness:codex',
        context: 'Focus on the remaining work',
      },
      { nodeId: 'summary-node', signal: expect.any(AbortSignal) },
    )
    finish({ markdown: '# Summary\n\n- Work remains', truncated: false, throughSeq: 9 })
    await vi.waitFor(() => expect(button('Copy Markdown')).toBeTruthy())
    const result = [...document.querySelectorAll<HTMLTextAreaElement>('textarea')].find((element) => element.readOnly)!
    expect(result.value).toBe('# Summary\n\n- Work remains')
    expect(document.activeElement).toBe(result)
    button('Copy Markdown').click()
    await vi.waitFor(() => expect(button('Copied')).toBeTruthy())
    expect(writeText).toHaveBeenCalledWith(result.value)
    vi.unstubAllGlobals()
  })

  it('keeps context on failure and allows a retry', async () => {
    summarize
      .mockRejectedValueOnce(new Error('Provider unavailable'))
      .mockResolvedValueOnce({ markdown: '# Retried', truncated: true, throughSeq: 11 })
    mount()
    button('Generate Markdown').click()
    await vi.waitFor(() => expect(document.body.textContent).toContain('Provider unavailable'))
    expect(button('Generate Markdown').disabled).toBe(false)
    button('Generate Markdown').click()
    await vi.waitFor(() => expect(button('Copy Markdown')).toBeTruthy())
    expect(document.body.textContent).toContain('some middle history is omitted')
    expect(summarize).toHaveBeenCalledTimes(2)
  })

  it('aborts generation when dismissed and ignores a late result', async () => {
    let finish!: (value: SessionSummary) => void
    summarize.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    mount()
    button('Generate Markdown').click()
    const signal = (summarize.mock.calls[0]![2] as { signal: AbortSignal }).signal
    button('Close').click()
    expect(signal.aborted).toBe(true)
    finish({ markdown: '# Late result', truncated: false, throughSeq: 12 })
    await Promise.resolve()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})
