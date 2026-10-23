import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

// Who may load a preview. A grant is made when a paired device opens a preview, and it names no task and
// no secret that the relay could see: the preview's name is random, and the two secrets travel inside TLS.
// The entry key is spent by the first request, which gets the cookie in exchange. Everything is in memory,
// so a restart ends every preview, and the phone opens another.

const ENTRY_KEY_MS = 60_000
const GRANT_MS = 12 * 3600_000
// An open preview costs a name and a cookie, nothing more, but a phone that opens one each time it is
// shown shouldn't leave them all behind.
const MAX_GRANTS = 8

export type PreviewGrant = {
  /** The preview's label, the first one in its name. */
  id: string
  /** The paired device that opened it. */
  deviceId: string | undefined
  /** The origin allowed to frame the page, or undefined for none. */
  ancestor: string | undefined
  /** The dev server's port now, since a task's address can change under an open preview. */
  port(): Promise<number | null>
  /** The secret the browser's cookie holds. */
  cookie: string
  expiresAt: number
}
type Entry = PreviewGrant & { entryKey: string | undefined; entryExpiresAt: number }

// The hash of each side, so a comparison takes the same time whatever the secrets share.
const digest = (text: string): Buffer => createHash('sha256').update(text).digest()
const same = (a: string, b: string): boolean => timingSafeEqual(digest(a), digest(b))

export class PreviewGrants {
  readonly #grants = new Map<string, Entry>()
  readonly #now: () => number

  constructor(now: () => number = Date.now) {
    this.#now = now
  }

  open(request: Pick<PreviewGrant, 'deviceId' | 'ancestor' | 'port'>): { id: string; entryKey: string } {
    this.#sweep()
    // The oldest goes first, which is the first in a Map.
    while (this.#grants.size >= MAX_GRANTS) this.#grants.delete(this.#grants.keys().next().value!)
    const id = randomBytes(16).toString('hex')
    const entryKey = randomBytes(24).toString('base64url')
    this.#grants.set(id, {
      ...request,
      id,
      cookie: randomBytes(24).toString('base64url'),
      expiresAt: this.#now() + GRANT_MS,
      entryKey,
      entryExpiresAt: this.#now() + ENTRY_KEY_MS,
    })
    return { id, entryKey }
  }

  // A live grant by its label, whether or not the caller holds its secrets.
  get(id: string): PreviewGrant | undefined {
    const grant = this.#grants.get(id)
    if (grant && grant.expiresAt <= this.#now()) this.#grants.delete(id)
    return this.#grants.get(id)
  }

  // The entry key works once, and for a minute.
  spendEntryKey(id: string, key: string): PreviewGrant | undefined {
    const grant = this.#grants.get(id)
    if (!grant?.entryKey || grant.entryExpiresAt <= this.#now() || !same(grant.entryKey, key)) return undefined
    grant.entryKey = undefined
    return this.get(id)
  }

  holdsCookie(grant: PreviewGrant, cookie: string | undefined): boolean {
    return cookie !== undefined && same(grant.cookie, cookie)
  }

  revokeDevice(deviceId: string): void {
    for (const [id, grant] of this.#grants) if (grant.deviceId === deviceId) this.#grants.delete(id)
  }

  clear(): void {
    this.#grants.clear()
  }

  #sweep(): void {
    for (const [id, grant] of this.#grants) if (grant.expiresAt <= this.#now()) this.#grants.delete(id)
  }
}
