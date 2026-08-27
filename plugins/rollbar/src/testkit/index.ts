// The test seam for this package (docs/architecture-overview.md § Package boundaries).
//
//   apps/node/test/integration/rollbar.test.ts   everything below
//   apps/node/test/registerProviders.ts          rollbarProvider, createRollbarFetch
//
// As with linear, the integration test mocks `./server/index.ts` by its own path because that is
// what rollbar's routes import, so that one subpath stays in this package's `exports` map.
export { rollbarFetch } from '../server/index'
export { rollbarProvider } from '../server/provider'
export { createRollbarFetch } from '../server/routes/rollbar'
export { ROLLBAR_ITEMS_STALE_AFTER_MS } from '../server/syncPolicy'
export type {
  RollbarItemDetail,
  RollbarItemMetadata,
  RollbarItemsResponse,
  RollbarOccurrenceDetail,
  RollbarOccurrencesResponse,
} from '../shared/api'
