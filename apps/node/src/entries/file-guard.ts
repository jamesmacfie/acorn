// The file guard entry (docs/managed-agents/read-block.md § Claude's own file tools): the build emits
// this module as file-guard.js beside mcp.js, and a session in the read block runs it under the app's
// bundled Node from a command hook. A dedicated entry, like loop-hook.ts, so the hook loads nothing else.
import { main } from '@acorn/node-core/mcp/fileGuard.ts'

void main()
