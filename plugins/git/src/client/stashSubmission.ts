/** One dialog owns one response. Cache invalidation keeps the submission's captured query keys. */
export function createStashSubmission() {
  let generation = 0
  return {
    invalidate: () => { generation++ },
    async run<T>(options: {
      targetTaskId: string
      request: () => Promise<T>
      refreshCaptured: () => void
      currentScope: () => boolean
      success: (value: T, targetTaskId: string) => void
      failure: (error: unknown) => void
      settled: () => void
    }): Promise<void> {
      const own = ++generation
      try {
        const value = await options.request()
        options.refreshCaptured()
        if (own === generation && options.currentScope()) options.success(value, options.targetTaskId)
      } catch (error) {
        options.refreshCaptured()
        if (own === generation && options.currentScope()) options.failure(error)
      } finally {
        if (own === generation && options.currentScope()) options.settled()
      }
    },
  }
}
