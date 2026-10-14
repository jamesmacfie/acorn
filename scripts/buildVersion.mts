import { execFileSync } from 'node:child_process'

// The build a bundle reports, as `ACORN_BUILD` in @acorn/protocol/node.ts: the date and hash of the
// commit it was built from, such as `2026-10-15 cde782f12aa0`. Every package says 1.0.0 and acorn tags
// no releases, so the commit is the one thing that tells two builds apart. The hash length is fixed,
// so two checkouts of one commit stamp the same string. The Node, desktop, and terminal configs pass
// it to `define` as `__ACORN_BUILD__`.
export const buildVersion = (): string => {
  try {
    return execFileSync('git', ['log', '-1', '--format=%cs %h', '--abbrev=12'], {
      cwd: import.meta.dirname,
      encoding: 'utf8',
    }).trim()
  } catch {
    // A build outside a Git checkout still has to finish.
    return 'unknown'
  }
}
