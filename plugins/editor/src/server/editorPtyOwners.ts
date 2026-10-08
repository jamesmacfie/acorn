import { canonicalCheckoutKey, withFileWriteLock } from './fileWriteLock'

// Node-wide PTY ownership, including other sockets/devices. A claim joins the checkout lock so a
// file action cannot race an opening external editor between its check and filesystem mutation.
const owners = new Map<string, Map<string, number>>()

export async function claimEditorPty(root: string, path: string): Promise<() => void> {
  const key = await canonicalCheckoutKey(root)
  return withFileWriteLock(key, async () => {
    const paths = owners.get(key) ?? new Map<string, number>()
    paths.set(path, (paths.get(path) ?? 0) + 1)
    owners.set(key, paths)
    let released = false
    return () => {
      if (released) return
      released = true
      const count = paths.get(path) ?? 0
      if (count <= 1) paths.delete(path)
      else paths.set(path, count - 1)
      if (!paths.size) owners.delete(key)
    }
  })
}

export async function activeEditorUnder(root: string, path: string): Promise<boolean> {
  const paths = owners.get(await canonicalCheckoutKey(root))
  return [...paths?.keys() ?? []].some((owned) => owned === path || owned.startsWith(`${path}/`))
}
