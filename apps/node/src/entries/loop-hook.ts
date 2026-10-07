// The harness bridge entry (docs/managed-agents/loop-hooks.md): the build emits this module as
// loop-hook.js beside mcp.js, and a bridged harness runs it under the app's bundled Node from its own
// command hook. A dedicated entry for the reason mcp.ts is one.
import { main } from '@acorn/node-core/mcp/loopHook.ts'

void main()
