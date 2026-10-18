// Its own module so the Node's boot graph, which needs only the folder's name for the Claude harness's
// read rule, doesn't pull in the cap and its file checks (./toolOutput.ts).
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const toolOutputRoot = () => join(tmpdir(), 'acorn-tool-output')

/** Where a task's full tool results go. The node and the MCP child share `TMPDIR` through the task
 *  environment, so both name the same folder. */
export const toolOutputDir = (taskId: string) => join(toolOutputRoot(), taskId)
