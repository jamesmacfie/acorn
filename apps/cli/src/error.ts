export type CliErrorShape = {
  apiVersion: 'acorn.cli/v1'
  error: { code: string; message: string; requestId?: string; retryable?: boolean }
}

export class CliError extends Error {
  constructor(readonly code: string, message: string, readonly exitCode: number, readonly requestId?: string, readonly retryable?: boolean, readonly partial?: unknown) {
    super(message)
  }
}

export function reportError(error: unknown, output: 'text' | 'json' | 'jsonl'): number {
  const safe = error instanceof CliError ? error : new CliError('internal_error', error instanceof Error ? error.message : String(error), 1)
  const envelope: CliErrorShape = {
    apiVersion: 'acorn.cli/v1',
    error: {
      code: safe.code,
      message: safe.message,
      ...(safe.requestId ? { requestId: safe.requestId } : {}),
      ...(safe.retryable !== undefined ? { retryable: safe.retryable } : {}),
    },
  }
  if (safe.partial) process.stdout.write(`${JSON.stringify(safe.partial)}\n`)
  process.stderr.write(output === 'text' ? `acorn: ${safe.message}\n` : `${JSON.stringify(envelope)}\n`)
  return safe.exitCode
}
