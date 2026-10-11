/**
 * A service built on first use, so its module stays out of the Node's boot graph
 * (apps/node/scripts/check-service-budget.mjs).
 */
export class LazyService<T> {
  private service: Promise<T> | null = null

  constructor(private readonly load: () => Promise<T>) {}

  /** The service, built by the first call. */
  get(): Promise<T> {
    return (this.service ??= this.load())
  }

  /** The service if a caller already built it. Diagnostics and shutdown read this, so they never build one. */
  built(): Promise<T> | null {
    return this.service
  }
}
