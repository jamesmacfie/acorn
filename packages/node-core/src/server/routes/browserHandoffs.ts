import { Hono } from 'hono'
import type { BrowserHandoffsResponse } from '@acorn/protocol/plugin/handoffs.ts'
import { browserHandoffs } from '../pluginHost/browserHandoffs'
import type { AppEnv } from '../middleware/auth'

// The browser extension's discovery read: every running plugin's browser handoffs, in one shape
// whichever tier declared them (docs/plugin-authoring/browser-handoffs.md). The extension matches
// pages against these itself and calls a handoff's own resolve route only when the person asks.
export const browserHandoffsRoute = new Hono<AppEnv>().get('/', (c) =>
  c.json({ handoffs: browserHandoffs() } satisfies BrowserHandoffsResponse),
)
