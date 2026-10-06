import type { PluginRailItem } from '@acorn/protocol/api.ts'

// Both hosts filter the source's loaded rows locally. Identifiers come from display and link
// contracts, since the row id can contain an opaque connection id or a storage key.
export function filterSourceItems(items: PluginRailItem[], query: string): PluginRailItem[] {
  const text = query.trim().toLowerCase()
  if (!text) return items
  const identifierQuery = /^#\d+$/.test(text) ? text.slice(1) : text
  return items.filter((item) => item.title.toLowerCase().includes(text)
    || [item.short, item.task?.link?.identifier, item.task?.link?.ref?.displayId]
      .some((identifier) => identifier?.toLowerCase().includes(identifierQuery)))
}
