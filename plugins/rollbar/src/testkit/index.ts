// The test seam for this package (docs/architecture/packages.md § Package boundaries).
//
//   apps/node/test/integration/plugins/rollbar.test.ts   everything below
//   apps/node/test/helpers/registerProviders.ts          rollbarProvider, createRollbarFetch
//
// As with linear, the integration test mocks the `server/index` module by its own path because that is
// what rollbar's routes import, so that one subpath stays in this package's `exports` map.
export { rollbarFetch } from '../server/index'
export { rollbarProvider } from '../server/provider'
export { createRollbarFetch } from '../server/routes/rollbar'
export type {
  RollbarItemDetail,
  RollbarItemMetadata,
  RollbarItemsResponse,
  RollbarOccurrenceDetail,
  RollbarOccurrencesResponse,
} from '../shared/api'
