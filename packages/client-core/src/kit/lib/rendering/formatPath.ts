// A folder path cut to the part that tells one project from another: the last two folders, with the
// home folder written as `~`. Every project under one parent shares the start of its path, so cutting
// the end, as an ellipsis does, hides the only part that differs. Callers put the full path in a tip.
//
// The path comes from the node, which can be another machine, so this window cannot ask for that
// machine's home folder. It recognises the usual home layouts instead: `/Users/<name>` on macOS,
// `/home/<name>` on Linux, and `C:\Users\<name>` on Windows.
const HOME = /^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=[/\\]|$)/

export function formatPath(path: string): string {
  const separator = path.includes('\\') && !path.includes('/') ? '\\' : '/'
  const trimmed = path.length > 1 ? path.replace(/[/\\]+$/, '') : path
  const home = HOME.exec(trimmed)?.[1]
  const rest = home ? trimmed.slice(home.length) : trimmed
  const parts = rest.split(/[/\\]/).filter(Boolean)
  if (parts.length <= 2) return home ? ['~', ...parts].join(separator) : trimmed
  return ['…', ...parts.slice(-2)].join(separator)
}
