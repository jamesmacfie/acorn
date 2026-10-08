import { open, stat } from 'node:fs/promises'
import { TextDecoder } from 'node:util'
import type { CoreServices } from '@acorn/plugin-api/node'
import type { AgentCheck, CheckResults, CheckVerdict } from '../../shared/delegationSchemas'
import type { AgentTurn } from '../../contract/wire.ts'

const JSON_LIMIT = 1024 * 1024

export function turnChecks(turn: AgentTurn): AgentCheck[] {
  const checks = turn.effectivePolicy.checks
  return Array.isArray(checks) ? checks as AgentCheck[] : []
}

export function savedCheckResults(turn: AgentTurn): CheckResults | null {
  const value = turn.effectivePolicy.checkResults
  return value && typeof value === 'object' && 'checkedAt' in value && 'verdicts' in value
    ? value as CheckResults : null
}

export class DelegationChecks {
  constructor(private readonly core: Pick<CoreServices, 'tasks' | 'fs' | 'git'>) {}

  async runInRoot(turn: AgentTurn, root: string | null, baseCommit: string | undefined): Promise<CheckResults> {
    const verdicts: CheckVerdict[] = []
    for (const check of turnChecks(turn)) {
      if (turn.status !== 'completed') {
        verdicts.push({ check, status: 'unverified', reason: `Turn ${turn.status}.` })
        continue
      }
      if (!root) {
        verdicts.push({ check, status: 'unverified', reason: 'Child worktree is unavailable.' })
        continue
      }
      verdicts.push(await this.evaluate(check, root, baseCommit))
    }
    return { checkedAt: Date.now(), verdicts }
  }

  private async evaluate(check: AgentCheck, root: string, baseCommit: string | undefined): Promise<CheckVerdict> {
    const result = (status: CheckVerdict['status'], reason: string): CheckVerdict => ({ check, status, reason: reason.slice(0, 200) })
    if (check.kind === 'commits-ahead') {
      if (!baseCommit) return result('unverified', 'Spawn base commit is unavailable.')
      try {
        const count = Number((await this.core.git.gitText(['rev-list', '--count', `${baseCommit}..HEAD`], { cwd: root, maxOutputBytes: 100 })))
        if (!Number.isSafeInteger(count)) return result('unverified', 'Git returned an invalid count.')
        return count > 0 ? result('holds', `${count} commit${count === 1 ? '' : 's'} ahead of spawn base.`) : result('fails', 'No commits ahead of spawn base.')
      } catch { return result('unverified', 'Could not read commit history.') }
    }
    const confined = await this.core.fs.confineExistingFile(root, check.path)
    if (!confined.ok) {
      if (confined.reason === 'missing') return result('fails', 'File does not exist.')
      if (confined.reason === 'not-file') return result('fails', 'Path is not a regular file.')
      return result('unverified', 'Path leaves the worktree.')
    }
    try {
      const file = await stat(confined.path)
      if (check.kind === 'file-exists') return result('holds', 'Regular file exists.')
      if (check.kind === 'file-nonempty') return file.size > 0 ? result('holds', `${file.size} bytes.`) : result('fails', 'File is 0 bytes.')
      if (file.size > JSON_LIMIT) return result('unverified', 'JSON file exceeds 1 MiB.')
      const handle = await open(confined.path, 'r')
      try {
        const bytes = Buffer.alloc(JSON_LIMIT + 1)
        let total = 0
        while (total < bytes.length) {
          const { bytesRead } = await handle.read(bytes, total, bytes.length - total, total)
          if (!bytesRead) break
          total += bytesRead
        }
        if (total > JSON_LIMIT) return result('unverified', 'JSON file exceeds 1 MiB.')
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, total))
        JSON.parse(text)
        return result('holds', 'File contains valid UTF-8 JSON.')
      } finally { await handle.close() }
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof TypeError) return result('fails', 'File is not valid UTF-8 JSON.')
      return result('unverified', 'Could not read file.')
    }
  }
}
