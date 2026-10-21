// Event feeds: sources the host stores and serves for a plugin, which appends to them
// (docs/data-sources/event-feeds.md). Registering one runs at plugin load, so this file only checks the
// declaration and builds its description. The store and the served operations load on first use from
// ./feedStore.ts.
import { dataFeedRegistrationSchema, type DataFeedRegistration } from '@acorn/protocol/dataSources.ts'
import { dataFieldsSchema } from '@acorn/protocol/dataBindings.ts'
import { parseDataSchema } from '@acorn/protocol/dataSchemas.ts'
import { feedDescription } from '@acorn/protocol/eventFeeds.ts'
import type { Disposable } from '../pluginHost/capabilities'
import { registerFeedSource } from './registry'
import { validateDescription } from './validation'

/** Registers a plugin's feed. The host answers its operations, so a feed has no route of its own. */
export function registerDataFeed(pluginId: string, input: DataFeedRegistration): Disposable {
  const { feed, ...source } = dataFeedRegistrationSchema.parse(input)
  const settings = feedDescription({
    sourceId: source.sourceId,
    feed: { ...feed, schema: parseDataSchema(feed.schema), fields: dataFieldsSchema.parse(feed.fields) },
  })
  try {
    validateDescription(settings.description)
  } catch {
    throw new Error(`The ${source.sourceId} feed's fields name a field its schema doesn't have`)
  }
  return registerFeedSource(pluginId, source, settings, async (request, env) =>
    (await import('./feedStore')).serveFeed(env, pluginId, settings, request),
  )
}
