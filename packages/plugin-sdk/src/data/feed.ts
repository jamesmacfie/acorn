// The event feed helper behind `acorn-plugin-sdk/data` (docs/data-sources/event-feeds.md). The
// description comes from the same protocol function the Node serves a feed with, so a test of the
// feed reads exactly what the Node will.
import { feedDescription } from '@acorn/protocol/eventFeeds.ts'
import type { DataFeedEvent } from 'acorn-plugin-types'
import { describeFields } from './derived.ts'
import type { defineEventFeed as DefineEventFeed } from './public.ts'

export const defineEventFeed: typeof DefineEventFeed = (definition) => {
  const { id, name, singular, plural, icon, identityScope, starterTriggers, retentionDays, maxEvents } = definition
  const { schema, fields } = describeFields(definition.fields)
  const feed = {
    schema,
    fields,
    ...(starterTriggers ? { starterTriggers } : {}),
    ...(retentionDays !== undefined ? { retentionDays } : {}),
    ...(maxEvents !== undefined ? { maxEvents } : {}),
  }
  const titlePointer = fields.find((field) => field.display?.role === 'title')?.pointer
  return {
    definition,
    manifest: {
      sourceId: id,
      name,
      singular,
      plural,
      identityScope: identityScope ?? 'An event ID is unique within this feed.',
      ...(icon ? { icon } : {}),
      ...(titlePointer ? { titlePointer } : {}),
      feed,
    },
    description: feedDescription({ sourceId: id, feed }).description,
    append: (ctx, events) => ctx.dataSources.append(id, events as DataFeedEvent[]),
  }
}
