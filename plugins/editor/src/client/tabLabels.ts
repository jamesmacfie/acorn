/** Keep the basename until another open path needs the same label. */
export function tabLabels(paths: readonly string[]): Map<string, string> {
  const names = new Map(paths.map((path) => [path, path.split('/').at(-1) ?? path]))
  const result = new Map(names)
  for (const path of paths) {
    const name = names.get(path)!
    const peers = paths.filter((other) => names.get(other) === name)
    if (peers.length < 2) continue
    const parents = path.split('/').slice(0, -1)
    for (let depth = 1; depth <= parents.length; depth++) {
      const suffix = parents.slice(-depth).join('/')
      if (peers.every((other) => other === path || other.split('/').slice(0, -1).slice(-depth).join('/') !== suffix)) {
        result.set(path, `${name} — ${suffix}`)
        break
      }
    }
  }
  return result
}
