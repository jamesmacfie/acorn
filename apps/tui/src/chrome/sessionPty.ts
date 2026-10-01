import type { PtyIo } from '@acorn/client-core/kit/lib'
import type { ServerMsg } from '@acorn/plugin-terminal/contract/wire.ts'

export type SessionPtyApi = {
  attach(id: string, on: (message: ServerMsg) => void, size?: { cols: number; rows: number }): () => void
  write(id: string, data: string): void
  resize(id: string, cols: number, rows: number): Promise<boolean>
}

/** Adapt Terminal's existing PTY channel to the kit's host-owned emulator. */
export function sessionPty(
  api: SessionPtyApi,
  id: string,
  onError: (message: string) => void,
  onExit: () => void,
): PtyIo {
  return {
    open: (size, onEvent) => api.attach(id, (message) => {
      if (message.type === 'output') onEvent({ kind: 'out', data: message.data })
      else if (message.type === 'exit') { onEvent({ kind: 'exit', code: message.exitCode }); onExit() }
      else if (message.type === 'error') onError(message.message)
    }, size),
    input: (data) => api.write(id, data),
    resize: ({ cols, rows }) => { void api.resize(id, cols, rows).then((resized) => {
      if (!resized) onError('The terminal did not accept the new size.')
    }, (cause: unknown) => {
      onError(cause instanceof Error ? cause.message : 'Unable to resize terminal.')
    }) },
    farewell: '[session ended]',
  }
}
