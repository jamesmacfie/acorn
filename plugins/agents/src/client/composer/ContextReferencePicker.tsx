import { createSignal } from 'solid-js'
import type { AgentContextContribution, AgentContextOption } from '@acorn/protocol/agentContext.ts'
import { Button, Icon, Picker } from '@acorn/plugin-api/ui'
import type { ContextCatalog } from './contextCatalog'
import { categorySuggestions, itemSuggestions, type ContextReference } from './contextReferences'

type Row = { contribution: AgentContextContribution; option?: AgentContextOption }

// The most items one category shows. Typing narrows it, and a source that searches answers its own.
const ITEM_LIMIT = 50

/**
 * The **Context** button: the same two steps as typing `#`, as a list. Pick a category, then tick its
 * items. A tick writes the item's token into the draft and an untick takes it out, so the text stays
 * the one record of what is attached. Escape steps back from the items to the categories.
 */
export default function ContextReferencePicker(props: {
  catalog: ContextCatalog
  /** The tokens in the draft right now, which is what shows ticked. */
  references: () => readonly ContextReference[]
  disabled?: boolean
  onAdd: (contribution: AgentContextContribution, option?: AgentContextOption) => void
  onRemove: (references: readonly ContextReference[]) => void
  onDone: () => void
}) {
  const [category, setCategory] = createSignal<AgentContextContribution>()
  // Mirrors the Picker's filter, which clears itself on the way into a category and out of it.
  const [query, setQuery] = createSignal('')
  const step = (next: AgentContextContribution | undefined) => {
    setQuery('')
    setCategory(next)
  }
  const referencing = (contribution: AgentContextContribution, option?: AgentContextOption) =>
    props
      .references()
      .filter((reference) => reference.keyword === contribution.keyword && reference.itemId === option?.id)

  const listing = () => {
    const open = category()
    return open ? props.catalog.listing(open, query()) : undefined
  }
  const rows = (filter: string): Row[] => {
    const open = category()
    if (!open)
      return categorySuggestions(props.catalog.contributions(), filter).map((contribution) => ({ contribution }))
    const items = props.catalog.listing(open, filter).items ?? []
    return (open.search ? items : itemSuggestions(items, filter.trim(), ITEM_LIMIT)).map((option) => ({
      contribution: open,
      option,
    }))
  }
  const toggle = (row: Row) => {
    const existing = referencing(row.contribution, row.option)
    if (existing.length) props.onRemove(existing)
    else props.onAdd(row.contribution, row.option)
  }
  // A row that is ticked: an item in the draft, or an itemless source such as `#task`.
  const ticked = (row: Row) =>
    (row.option || row.contribution.itemless) && referencing(row.contribution, row.option).length > 0

  return (
    <Picker<Row>
      label="Context"
      ariaLabel="Add Acorn context"
      size="sm"
      placement="top-start"
      keepOpen
      disabled={props.disabled}
      placeholder={category() ? `Filter ${category()!.label.toLowerCase()}…` : 'Filter context sources…'}
      emptyText={
        !category()
          ? 'No context sources available.'
          : (listing()?.error ?? (listing()?.items ? 'Nothing matches.' : 'Loading…'))
      }
      results={rows}
      rowLabel={(row) => row.option?.label ?? row.contribution.label}
      rowDescription={(row) => row.option?.description ?? `#${row.contribution.keyword}`}
      isActive={(row) => !!ticked(row)}
      leading={(row) =>
        row.option || row.contribution.itemless ? <Icon name={ticked(row) ? 'square-check' : 'square'} /> : undefined
      }
      onSearch={setQuery}
      onSelect={(row) => (row.option || row.contribution.itemless ? toggle(row) : step(row.contribution))}
      onBack={category() ? () => step(undefined) : undefined}
      footer={(close) => (
        <Button
          size="sm"
          onPress={() => {
            close()
            step(undefined)
            props.onDone()
          }}
        >
          Done
        </Button>
      )}
    />
  )
}
