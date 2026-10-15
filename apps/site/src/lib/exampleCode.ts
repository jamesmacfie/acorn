// The code a guide shows from an example plugin (docs/site/plugin-guides.md): a named region of a file,
// or the parts of a manifest a step adds. Files mark a region with `// #region <name>` and
// `// #endregion`. JSON can't hold a comment, so a manifest is cut by path instead.

const MARKER = /^\s*\/\/ #(?:region\b.*|endregion)\s*$/

/** The lines between `// #region <name>` and the `// #endregion` that closes it, without their common indent.
 *  With no name, the whole file. Either way, other region markers are left out. */
export function region(source: string, name?: string): string {
  const lines = source.split('\n')
  let picked = lines
  if (name) {
    const start = lines.findIndex((line) => line.trim() === `// #region ${name}`)
    if (start < 0) throw new Error(`No region named "${name}"`)
    // Regions nest, so the end is the `#endregion` that closes this one.
    let depth = 0
    const end = lines.findIndex((line, index) => {
      if (index <= start) return false
      if (line.trim().startsWith('// #region')) depth += 1
      else if (line.trim() === '// #endregion') depth -= 1
      return depth < 0
    })
    if (end < 0) throw new Error(`The region named "${name}" never ends`)
    picked = lines.slice(start + 1, end)
  }
  picked = picked.filter((line) => !MARKER.test(line))
  const indent = Math.min(...picked.filter((line) => line.trim()).map((line) => line.match(/^ */)![0].length))
  return picked
    .map((line) => line.slice(indent))
    .join('\n')
    .trim()
}

/**
 * The parts of a manifest a step adds, as a manifest of their own. Each path is dotted keys, such as
 * `contributions.sources`. A path ending in `#<id>` keeps only the array entries with that `id`, so
 * `contributions.frames#settings` is the one settings frame.
 */
export function pick(manifest: string, paths: string[]): string {
  const source = JSON.parse(manifest) as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const path of paths) {
    const [dotted, id] = path.split('#') as [string, string | undefined]
    const keys = dotted.split('.')
    let value: unknown = source
    for (const key of keys) {
      value = value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined
      if (value === undefined) throw new Error(`The manifest has no ${dotted}`)
    }
    if (id !== undefined) {
      const entries = (value as { id?: string }[]).filter((entry) => entry.id === id)
      if (!entries.length) throw new Error(`${dotted} has no entry with id "${id}"`)
      value = entries
    }
    let target = out
    for (const key of keys.slice(0, -1)) target = (target[key] ??= {}) as Record<string, unknown>
    const last = keys.at(-1)!
    target[last] = Array.isArray(target[last]) ? [...(target[last] as unknown[]), ...(value as unknown[])] : value
  }
  return JSON.stringify(out, null, 2)
}

/** The language a code block highlights a file as. */
export function language(file: string): string {
  const extension = file.split('.').at(-1)!
  return { js: 'js', mjs: 'js', json: 'json', ts: 'ts', tsx: 'tsx', md: 'md' }[extension] ?? 'text'
}
