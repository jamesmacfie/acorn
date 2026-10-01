import { createSignal } from 'solid-js'
import type { PickedFile, SaveRequest } from '@acorn/client-core/infra/platform'

export type FilePrompt =
  | { kind: 'pick'; accept: readonly string[] }
  | { kind: 'save'; request: SaveRequest }

type Queued = { prompt: FilePrompt; resolve: (result: PickedFile[] | boolean) => void }
const queue: Queued[] = []
const [active, setActive] = createSignal<FilePrompt | null>(null)
export const activeFilePrompt = active

function enqueue(prompt: FilePrompt): Promise<PickedFile[] | boolean> {
  return new Promise((resolve) => {
    queue.push({ prompt, resolve })
    if (queue.length === 1) setActive(prompt)
  })
}

/** Bytes cross this host seam; a local path never reaches the Node API. */
export const pickLocalFile = (options: { accept?: readonly string[] }): Promise<PickedFile[]> =>
  enqueue({ kind: 'pick', accept: options.accept ?? [] }) as Promise<PickedFile[]>

export const saveLocalFile = (request: SaveRequest): Promise<boolean> =>
  enqueue({ kind: 'save', request }) as Promise<boolean>

export function finishFilePrompt(result?: PickedFile[] | boolean): void {
  const current = queue.shift()
  if (!current) return
  current.resolve(result ?? (current.prompt.kind === 'pick' ? [] : false))
  setActive(queue[0]?.prompt ?? null)
}

/** Test teardown must also settle any action awaiting a dialog. */
export function resetFilePrompts(): void {
  while (queue.length) finishFilePrompt()
}
