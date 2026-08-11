// One-time sweep of `localStorage` keys no current writer owns, run once per renderer activation.
//
// It exists because of one specific class of leftover: keys an OLDER release wrote that carried
// credentials in plaintext. Dropping the writer stops new ones appearing and does nothing about the bytes
// already on the device, and the device that matters is the one upgrading straight from the release that
// wrote them.
//
// This used to be a plugin's own `activate` hook — http purged `http-draft:*` before its panel could read
// one back. It is here now because http ships as a loaded plugin: a frame's `localStorage` is its own,
// keyed by bundle hash at an `app-plugin://` origin, so a purge running inside the frame would sweep a
// storage area that never held these keys and report success. The bytes are the SHELL's, and so is the
// cleanup — which is the better home for it anyway, since what is being cleaned up is a decision an old
// version of the app made, not a decision a plugin made.
//
// A flat list rather than a registry: a prefix goes in when a writer is retired and comes out when no
// supported upgrade path can still be carrying it. Two entries would not justify a contribution point.
const RETIRED_KEY_PREFIXES = [
  // Unsaved API-panel drafts, headers/auth/body included. Saved requests are server-encrypted now and
  // unsaved credential-bearing drafts stay memory-only (plugins/http/src/frame/draft.ts).
  'http-draft:',
] as const

type SweepableStorage = Pick<Storage, 'length' | 'key' | 'removeItem'>

/** Returns the keys removed, so a caller can log or a test can assert without reading storage back. */
export function purgeRetiredLocalStorage(storage: SweepableStorage = localStorage): string[] {
  const doomed: string[] = []
  // Collected before removing anything: `removeItem` reindexes, so mutating mid-enumeration skips keys.
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (key && RETIRED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) doomed.push(key)
  }
  for (const key of doomed) storage.removeItem(key)
  return doomed
}
