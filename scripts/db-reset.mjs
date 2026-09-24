// Explicit, recoverable reset of Acorn-owned filesystem state. Run without --execute to inspect.
import { runReset, parseResetArguments } from './reset/run.mjs'

try {
  const result = runReset(parseResetArguments(process.argv.slice(2)))
  console.log(JSON.stringify(result, null, 2))
  console.error(`${result.files.length} owned file(s); ${result.outstanding.length} host adapter(s) outstanding. ${result.mode === 'inventory' ? 'No files changed.' : `Recovery: ${result.recoveryDir}`}`)
  if (result.mode === 'reset') console.error('Repository files and worktrees remain on disk. Re-add retained worktrees explicitly; restore this snapshot only with the old Acorn binary.')
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
