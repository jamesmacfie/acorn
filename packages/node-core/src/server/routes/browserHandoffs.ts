import { Hono } from 'hono'
import type { BrowserHandoffsResponse } from '@acorn/protocol/plugin/handoffs.ts'
import { browserHandoffs, browserPanels, taskAddressRoutes } from '../pluginHost/browserHandoffs'
import type { AppEnv } from '../middleware/auth'

// The browser extension's discovery read: every running plugin's browser handoffs, task address
// routes, and sidebar panels, in one shape whichever tier declared them (docs/plugin-authoring/browser-handoffs.md). The
// extension matches pages against these itself, and its host calls a plugin's own routes.
export const browserHandoffsRoute = new Hono<AppEnv>().get('/', (c) =>
  c.json({
    handoffs: browserHandoffs(),
    taskAddresses: taskAddressRoutes(),
    panels: browserPanels(),
  } satisfies BrowserHandoffsResponse),
)
