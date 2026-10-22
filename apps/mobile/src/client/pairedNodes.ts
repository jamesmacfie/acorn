import { createStore, del, entries, get, set } from 'idb-keyval'

// The Nodes this phone is paired with, and the device token for each (docs/relay/phone-channel.md § A device
// for each phone). They live in IndexedDB. A token is stored encrypted under an AES-GCM key the browser
// made and will not hand over, so a copy of the browser's storage holds ciphertext it can't open. That
// doesn't protect against script running in the app itself.
//
// It imports nothing that reads the platform seam, because `main.tsx` installs the seam before the app
// loads.

export type PairedNode = {
  nodeId: string
  label: string
  /** The Node's channel key, 64 hex characters, which the phone checked at pairing and holds it to. */
  channelKey: string
  pairedAt: number
}
type Sealed = { iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer }
type Stored = PairedNode & { token: Sealed }

const store = createStore('acorn-phone', 'paired')
const KEY = 'key'
const nodeKey = (nodeId: string) => `node:${nodeId}`

const encoder = new TextEncoder()

// Made on first use. `extractable: false` is the whole point, and a CryptoKey survives structured clone,
// so IndexedDB keeps the key itself and not its bytes.
async function sealingKey(): Promise<CryptoKey> {
  const kept = await get<CryptoKey>(KEY, store)
  if (kept) return kept
  const made = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  await set(KEY, made, store)
  return made
}

// Bound to the Node's ID, so a token moved to another record doesn't open.
async function seal(nodeId: string, token: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(nodeId) },
    await sealingKey(),
    encoder.encode(token),
  )
  return { iv, data }
}

export async function pairedNodes(): Promise<PairedNode[]> {
  const all = await entries<string, Stored>(store)
  return all
    .filter(([key]) => key.startsWith('node:'))
    .map(([, { token: _token, ...node }]) => node)
    .sort((a, b) => a.pairedAt - b.pairedAt)
}

/** The device token for a Node, or null when there is none or it won't open. */
export async function readToken(nodeId: string): Promise<string | null> {
  const record = await get<Stored>(nodeKey(nodeId), store)
  if (!record) return null
  try {
    const bytes = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: record.token.iv, additionalData: encoder.encode(nodeId) },
      await sealingKey(),
      record.token.data,
    )
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

export async function savePaired(node: PairedNode, token: string): Promise<void> {
  await set(nodeKey(node.nodeId), { ...node, token: await seal(node.nodeId, token) } satisfies Stored, store)
}

export async function renamePaired(nodeId: string, label: string): Promise<void> {
  const record = await get<Stored>(nodeKey(nodeId), store)
  if (record) await set(nodeKey(nodeId), { ...record, label }, store)
}

export const forgetPaired = (nodeId: string): Promise<void> => del(nodeKey(nodeId), store)
