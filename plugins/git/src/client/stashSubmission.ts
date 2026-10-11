import { latestSignal } from '@acorn/plugin-api/client'

/** One dialog owns one response. Cache invalidation keeps the submission's captured query keys. */
export function createStashSubmission() {
  const submission = latestSignal()
  return {
    invalidate: () => submission.abort(),
    async run<T>(options: {
      targetTaskId: string
      request: () => Promise<T>
      refreshCaptured: () => void
      currentScope: () => boolean
      success: (value: T, targetTaskId: string) => void
      failure: (error: unknown) => void
      settled: () => void
    }): Promise<void> {
      const signal = submission.next()
      try {
        const value = await options.request()
        options.refreshCaptured()
        if (!signal.aborted && options.currentScope()) options.success(value, options.targetTaskId)
      } catch (error) {
        options.refreshCaptured()
        if (!signal.aborted && options.currentScope()) options.failure(error)
      } finally {
        if (!signal.aborted && options.currentScope()) options.settled()
      }
    },
  }
}
