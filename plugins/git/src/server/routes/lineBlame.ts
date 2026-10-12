import { z } from 'zod'
import { BridgeError, requireDevice, type CoreServices } from '@acorn/plugin-api/node'
import { gitRouter } from './router'
import { createLineBlame } from '../lineBlame'
import { readGate } from '../readGate'

// Each key is checked on its own in ../lineBlame.ts, so one malformed key costs its mark, not the
// request. The host's raw-row ceiling bounds the batch.
const request = z.object({ keys: z.array(z.unknown()).max(4_096) })

/** `editor:line` marks: who last changed each line the host asks about (../lineBlame.ts). */
export function lineBlameRoutes(core: Pick<CoreServices, 'git' | 'tasks'>) {
  const limited = readGate()
  const blame = createLineBlame(core)
  return gitRouter()
    .use('/editor/line-blame', requireDevice)
    .post('/editor/line-blame', async (c) => {
      const parsed = request.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) throw new BridgeError(400, 'bad_request', 'Invalid line blame request.')
      const { keys } = parsed.data
      return c.json({ items: await limited(c.req.raw.signal, () => blame(keys, c.req.raw.signal)) })
    })
}
