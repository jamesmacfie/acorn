import { Hono } from 'hono'
import { readRuns } from '../runs/registry'
import { isTaskConfined, mayActOnTask } from '../middleware/requireUser'
import type { AppEnv } from '../middleware/auth'

// The unified run list (@acorn/protocol/runs.ts). A merged read over whatever plugins registered a run
// source; no table, no join, and no plugin importing another.
//
// A task-confined caller sees its own task's runs and nothing else. Filtering rather than 403ing,
// because "what is running for me" is a reasonable question for an agent to ask about its own task,
// while the node-wide answer enumerates every task on the machine — the same rule the session list
// applies to the same caller.
export const runs = new Hono<AppEnv>().get('/', async (c) => {
  const { runs, failed } = await readRuns(c.env)
  const visible = isTaskConfined(c) ? runs.filter((run) => !!run.taskId && mayActOnTask(c, run.taskId)) : runs
  return c.json({
    runs: visible,
    // Which sources could not answer, so a short list reads as short rather than as complete. A run
    // list with a wedged source is still worth showing (../runs/registry.ts says why).
    failed,
  })
})
