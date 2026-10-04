import type { Env } from '../bindings'
import type { AppDatabase } from '../db'
import type { Scheduler } from '../schedules/scheduler'

export function registerDatasetCaptureTarget(scheduler: Scheduler, db: AppDatabase, env: Env): void {
  scheduler.registerTarget({
    kind: 'dataset-capture',
    options: () => (db.$client.prepare("SELECT id, name FROM datasets WHERE feeder = 'capture'").all() as { id: string; name: string }[])
      .map(dataset => ({ kind: 'dataset-capture' as const, datasetId: dataset.id, name: `Capture ${dataset.name}`, risk: 'write' as const })),
    parse: raw => {
      if (!raw || typeof raw !== 'object' || !('datasetId' in raw) || typeof raw.datasetId !== 'string') return null
      const row = db.$client.prepare("SELECT 1 FROM datasets WHERE id = ? AND feeder = 'capture'").get(raw.datasetId)
      return row ? { datasetId: raw.datasetId } : null
    },
    risk: () => 'write',
    run: async (raw, signal) => {
      const { captureDataset } = await import('./capture')
      return captureDataset(db, env, (raw as { datasetId: string }).datasetId, signal)
    },
  })
}
