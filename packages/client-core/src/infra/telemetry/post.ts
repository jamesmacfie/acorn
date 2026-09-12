import { coreTelemetryRoute } from '@acorn/protocol/api.ts'
import { encodeTelemetryBatches, type PostedTelemetryRuntime, type TelemetryRecord } from '@acorn/protocol/telemetry.ts'
import { sendJson } from '../node/apiClient'
import type { TelemetryPoster } from './emitter'

// How a batch leaves a client and reaches the node's collector (docs/telemetry.md § Other runtimes).
//
// Through the ordinary API client, so it goes over the broker with the device token and the pinned
// certificate like every other request, and `unmeasured` so it does not produce a span of its own. A
// span per batch would be a batch per span, and the two would chase each other for as long as the
// owner left telemetry on.
//
// A rejection is left to reach the emitter, which puts the records back at the front of its queue.
// The node being offline is the case this whole queue exists for.

export const postTelemetryBatch = (runtime: PostedTelemetryRuntime): TelemetryPoster =>
  async (records: readonly TelemetryRecord[]) => {
    for (const body of encodeTelemetryBatches(runtime, records)) await sendJson<{ accepted: number }>(coreTelemetryRoute, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      unmeasured: true,
    })
  }
