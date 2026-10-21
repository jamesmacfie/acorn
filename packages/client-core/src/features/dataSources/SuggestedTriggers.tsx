import { createMemo, createResource, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import type { QueryReference } from '@acorn/protocol/dataQueries.ts'
import type { DataSourceDescription, DataSourceScope } from '@acorn/protocol/dataSources.ts'
import type { RecordChange, StarterTrigger } from '@acorn/protocol/starterTriggers.ts'
import { activeCacheId } from '../../infra/node/activeNode'
import { integrationsOptions } from '../../infra/queries'
import { Row } from '../../kit/components/primitives'
import { Rows } from '../../kit/components/layout/Rows'
import { Stack } from '../../kit/components/layout/Stack'
import { Text } from '../../kit/components/content/Text'
import Icon from '../../kit/components/content/Icon'
import { dataSourceCatalogOptions, dataSourceQueryOptions } from './queries'
import { defaultInputBindings, sourceEntries, sourceReference, type SourceEntry } from './sourceEntries'

// The trigger dialog's first screen: the triggers every source this project can read suggests
// (docs/plugin-authoring/triggers.md). Each source is listed once per account, as the source picker
// lists it, and the Node has already dropped any suggestion that doesn't fit its source.

/** A suggestion, moved onto the account and scope it was listed under. `reference` reads the records
 *  the suggestion's filter matches. */
export type SuggestedTrigger = {
  key: string
  label: string
  description: string
  source: string
  reference: QueryReference
  change: RecordChange
}

export default function SuggestedTriggers(props: {
  workspaceId: string
  projectId: string
  onPick(suggestion: SuggestedTrigger): void
}) {
  const nodeId = activeCacheId()
  const queryClient = useQueryClient()
  const scope = (): DataSourceScope => ({ workspaceId: props.workspaceId, projectId: props.projectId, parameters: {} })
  const catalog = createQuery(() => ({ ...dataSourceCatalogOptions(nodeId, scope()), enabled: !!props.workspaceId }))
  const integrations = createQuery(() => integrationsOptions(true))
  const entries = createMemo(() => {
    const sources = catalog.data?.sources ?? []
    const connections = integrations.data?.integrations ?? []
    return sourceEntries({ sources, connections, saved: [], byAccount: true }).flatMap((entry) =>
      entry.kind === 'source'
        ? [
            {
              entry,
              scope: JSON.parse(
                JSON.stringify({
                  ...scope(),
                  ...(entry.connectionId ? { connectionId: entry.connectionId } : {}),
                  ...(entry.source.inputs ? { inputs: defaultInputBindings(entry.source, sources, connections) } : {}),
                }),
              ) as DataSourceScope,
            },
          ]
        : [],
    )
  })
  // One describe per listed source, through the shared cache. A source that fails to describe has no
  // suggestions to offer, so its failure is dropped. The catalog row is a reactive proxy, which the
  // strict data parsers behind a request's key refuse, so the request and its scope are plain copies.
  const [suggestions] = createResource(
    () => (catalog.data && integrations.data ? entries() : undefined),
    async (listed) => {
      const described = await Promise.all(
        listed.map(({ entry, scope }) =>
          queryClient
            .fetchQuery(
              dataSourceQueryOptions(nodeId, {
                operation: 'describe',
                source: { pluginId: entry.source.pluginId, sourceId: entry.source.sourceId },
                scope,
              }),
            )
            .then(
              (description) => ({ entry, scope, description: description as DataSourceDescription }),
              () => undefined,
            ),
        ),
      )
      return described.flatMap((found) => (found ? suggestionsOf(found.entry, found.scope, found.description) : []))
    },
  )

  return (
    <Show
      when={suggestions()?.length}
      fallback={
        <Text emphasis="muted" wrap>
          {suggestions.loading || catalog.isPending
            ? 'Looking for suggestions…'
            : "None of this project's sources suggests a trigger."}
        </Text>
      }
    >
      <Rows
        id="data-sources.suggested-triggers"
        ariaLabel="Suggested triggers"
        items={suggestions()!.map((suggestion) => ({ key: suggestion.key, label: suggestion.label, suggestion }))}
        selected={null}
        onSelect={(key) => {
          const picked = suggestions()!.find((suggestion) => suggestion.key === key)
          if (picked) props.onPick(picked)
        }}
      >
        {(item, itemProps, selected) => (
          <Row
            item={itemProps}
            selected={selected()}
            density="compact"
            variant="stacked"
            onPress={() => props.onPick(item.suggestion)}
            leading={<Icon name="sparkles" />}
            trailing={<Icon name="chevron-right" />}
          >
            <Stack gap="none">
              <Text>{item.suggestion.label}</Text>
              <Text emphasis="muted">{`${item.suggestion.description} · ${item.suggestion.source}`}</Text>
            </Stack>
          </Row>
        )}
      </Rows>
    </Show>
  )
}

function suggestionsOf(
  entry: Extract<SourceEntry, { kind: 'source' }>,
  scope: DataSourceScope,
  description: DataSourceDescription,
): SuggestedTrigger[] {
  const starters = JSON.parse(JSON.stringify(description.starterTriggers ?? [])) as StarterTrigger[]
  return starters.map((starter) => {
    const reference = sourceReference(entry.source, scope)
    return {
      key: `${entry.id}|${starter.id}`,
      label: starter.label,
      description: starter.description,
      source: entry.label,
      change: starter.change,
      reference:
        reference.kind === 'inline'
          ? {
              ...reference,
              content: {
                ...reference.content,
                name: starter.label,
                query: { ...reference.content.query, ...(starter.predicate ? { predicate: starter.predicate } : {}) },
              },
            }
          : reference,
    }
  })
}
