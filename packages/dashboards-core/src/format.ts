import type { PluginCollectionCell, PluginCollectionField } from '@acorn/protocol/collections.ts'
import { isPluginOpenableUrl } from '@acorn/protocol/externalUrl.ts'
import { formatRelativeTime } from './relativeTime'
import type { PanelTone } from './model'

// Renders a cell by its semantic type (@acorn/protocol/collections.ts): datetime gets an age, enum
// gets a toned chip, number gets its field's unit. Hints come off the field, never the panel, the
// same choice model.ts makes for PanelDefinition. Pure and returns a description rather than JSX for
// the reason docs/dashboards.md § The generated editor gives: the component that draws this can't be
// tested in this repo, so the decision lives where it can be.

export type FormattedCell =
  | { kind: 'empty' }
  | { kind: 'text'; text: string }
  | { kind: 'number'; text: string }
  | { kind: 'boolean'; value: boolean; text: string }
  | { kind: 'datetime'; absolute: string; relative: string }
  | { kind: 'enum'; label: string; tone: PanelTone }
  | { kind: 'person'; name: string; initials: string }
  | { kind: 'link'; url: string; text: string }

const EMPTY: FormattedCell = { kind: 'empty' }

/** Up to two letters from a display name, for the `person` monogram.
 *
 *  A monogram rather than a fetched image: `person` is a display string on the wire, not a resolved
 *  account, so turning "Ada Lovelace" into a github avatar URL would be a guess rendered as fact, and
 *  it would be wrong for every provider whose people aren't github users. A monogram derives from the
 *  same string the label shows, so it adds scannability without adding a claim, and needs no network
 *  and no wire change.
 *
 *  Empty for a value with no letters or digits at all, which makes the name-only fallback a real
 *  branch rather than a circle with nothing in it. */
export function personInitials(name: string): string {
  // An address is one identity, not three words: splitting on the domain would put a "C" from
  // ".com" on the mark. A leading `@` is a handle rather than an address, so it's stripped instead
  // of split on. The difference is whether there's anything in front of it.
  const at = name.indexOf('@')
  const local = at > 0 ? name.slice(0, at) : name.replace(/^@+/, '')
  const words = local.split(/[\s._-]+/).filter(Boolean)
  const letters = words.flatMap((word) => [...word].find((glyph) => /[\p{L}\p{N}]/u.test(glyph)) ?? [])
  if (!letters.length) return ''
  return (letters.length > 1 ? letters[0] + letters[letters.length - 1] : letters[0]).toUpperCase()
}

/** `%` reads wrong with a space and every other unit reads wrong without one. */
const withUnit = (text: string, unit: string | undefined): string =>
  unit === undefined ? text : unit === '%' ? `${text}%` : `${text} ${unit}`

export function formatCell(
  field: PluginCollectionField,
  value: PluginCollectionCell | undefined,
  now = Date.now(),
): FormattedCell {
  // `null` means this row has no value here, which the wire distinguishes from an empty string.
  // Both draw as nothing; only the sort order tells them apart (shaping.ts).
  if (value === null || value === undefined || value === '') return EMPTY

  switch (field.type) {
    case 'number': {
      const numeric = Number(value)
      return Number.isFinite(numeric) ? { kind: 'number', text: withUnit(String(numeric), field.unit) } : EMPTY
    }
    case 'boolean':
      return { kind: 'boolean', value: Boolean(value), text: value ? 'Yes' : 'No' }
    case 'datetime': {
      // Epoch milliseconds, because that is what every other timestamp on this wire is. Both forms
      // are returned rather than one: the age is what a person reads and the absolute time is what
      // they check, so the age is the label and the absolute time is the tooltip.
      const at = Number(value)
      if (!Number.isFinite(at)) return EMPTY
      return {
        kind: 'datetime',
        absolute: new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
        relative: formatRelativeTime(at, now),
      }
    }
    case 'enum': {
      const id = String(value)
      const declared = field.values?.find((candidate) => candidate.id === id)
      // A value the schema never declared still renders. A query-shaped collection can't always know
      // its values ahead of the data; it just can't be pre-toned or pre-ordered.
      return { kind: 'enum', label: declared?.label ?? id, tone: declared?.tone ?? 'muted' }
    }
    case 'person': {
      const name = String(value)
      return { kind: 'person', name, initials: personInitials(name) }
    }
    case 'link': {
      const url = String(value)
      // Host-mediated: the same check `openUrl` applies before handing a plugin's URL to the
      // browser (plugins/chrome/actions.ts). A cell that fails it is a string, not a link.
      if (!isPluginOpenableUrl(url)) return { kind: 'text', text: url }
      return { kind: 'link', url, text: url.replace(/^https?:\/\//, '') }
    }
    case 'text':
      return { kind: 'text', text: String(value) }
  }
}

/** The one-line form, for a list row's meta strip and for any view with no room for a chip. */
export const cellText = (cell: FormattedCell): string => {
  switch (cell.kind) {
    case 'empty':
      return ''
    case 'datetime':
      return cell.relative
    case 'enum':
      return cell.label
    case 'person':
      return cell.name
    default:
      return cell.text
  }
}
