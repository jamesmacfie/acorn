// What the custody rules need from wherever a host keeps things. The desktop and the terminal client
// keep files (../plugins/fileStorage.ts), and the phone keeps IndexedDB (apps/mobile/src/client/pluginStorage.ts).
//
// The index and the trust record are small, so each is read and written whole, as text the rules parse
// themselves. A host whose storage is asynchronous loads both before it builds the rules and writes
// behind them. Bundle bytes are large and arrive once, so `writeBundle` may take its time, and the rules
// wait for it before they record the bundle.

export type BundleStorage = {
  /** The index text, or null when nothing has been stored. */
  readIndex(): string | null
  writeIndex(text: string): void
  /** Resolves once the bytes are kept, so the index never names bytes that aren't there. */
  writeBundle(hash: string, bytes: Uint8Array): void | Promise<void>
  /** Delete every bundle whose hash isn't in the set. */
  keepOnly(hashes: ReadonlySet<string>): void
}

export type TrustStorage = {
  /** The trust record's text, or null when nothing has been decided. */
  read(): string | null
  write(text: string): void
  /** Keep an unreadable record out of the way of the next write. Returns where it went. */
  setAside(): string
}

/** The two log lines the rules write. A host passes its own logger. */
export type RulesLog = {
  warn(message: string, attributes?: Record<string, string | number>): void
  error(message: string, attributes?: Record<string, string | number>): void
}

/** The hash of what arrived, as 64 lowercase hex characters. */
export type Sha256 = (bytes: Uint8Array) => string | Promise<string>
