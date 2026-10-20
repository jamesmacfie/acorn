import type { PluginFetchHandler } from '@acorn/plugin-api/node'
import { pullSourceDescription } from '../../shared/pullSourceDescription'
import { pullSearch } from './pullQuery'
import { readPullSelection } from './pullRead'
import { pullStateDetails, writePullState } from './pullWrite'
import { createSearchSourceHandler } from './searchSourceHandler'

export function createPullSourceHandler(): PluginFetchHandler {
  return createSearchSourceHandler({
    description: pullSourceDescription,
    read: (token, query, connectionId, signal) => readPullSelection(token, pullSearch(query), connectionId, signal),
    details: pullStateDetails,
    write: writePullState,
  })
}
