import type { DashboardDisplayCell, DashboardDisplayField } from './display'
import { isPluginOpenableUrl } from '@acorn/protocol/externalUrl.ts'
import { formatRelativeTime } from './relativeTime'
import type { PanelTone } from './model'

// Renders a cell by its semantic type: datetime gets an age, enum
// gets a toned chip, number gets its field's unit. Hints come off the field, never the panel, the
// same choice model.ts makes for PanelDefinition. Pure and returns a description rather than JSX for
// the reason docs/dashboards/mapping-and-editor.md § The generated editor gives: the component that draws this can't be
// tested in this repo, so the decision lives where it can be.

export type FormattedCell =
  | { kind: 'empty' }
  | { kind: 'text'; text: string }
  | { kind: 'number'; text: string }
  | { kind: 'boolean'; value: boolean; text: string }
  | { kind: 'datetime'; absolute: string; relative: string }
  | { kind: 'enum'; label: string; tone: PanelTone; icon?: string }
  | { kind: 'person'; name: string; initials: string }
  | { kind: 'link'; url: string; text: string }
  | { kind: 'list'; items: FormattedCell[] }

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

/** Digit grouping and at most two decimals, in the device locale. No unit asks for more precision yet;
 *  workstream 2's units decide their own. */
const NUMBER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

/** `%` reads wrong with a space and every other unit reads wrong without one. */
const withUnit = (text: string, unit: string | undefined): string =>
  unit === undefined ? text : unit === '%' ? `${text}%` : `${text} ${unit}`

export function formatCell(
  field: DashboardDisplayField,
  value: DashboardDisplayCell | undefined,
  now = Date.now(),
): FormattedCell {
  // `null` means this row has no value here, which the wire distinguishes from an empty string.
  // Both draw as nothing; only the sort order tells them apart (shaping.ts).
  if (value === null || value === undefined || value === '') return EMPTY
  if (Array.isArray(value)) return { kind: 'list', items: value.map(item => formatCell({ ...field, list: false }, item, now)) }

  switch (field.type) {
    case 'number': {
      const numeric = Number(value)
      if (!Number.isFinite(numeric)) return EMPTY
      const unit = field.unit
      if (unit && /^[A-Z]{3}$/.test(unit)) return { kind: 'number', text: new Intl.NumberFormat(undefined, { style: 'currency', currency: unit, maximumFractionDigits: 2 }).format(numeric) }
      if (unit === 'percent') return { kind: 'number', text: `${NUMBER.format(numeric)}%` }
      if (unit === 'ms' || unit === 's') return { kind: 'number', text: withUnit(NUMBER.format(unit === 's' ? numeric * 1000 : numeric), 'ms') }
      if (unit === 'bytes') return { kind: 'number', text: new Intl.NumberFormat(undefined, { style: 'unit', unit: 'byte', unitDisplay: 'short', maximumFractionDigits: 2 }).format(numeric) }
      return { kind: 'number', text: withUnit(NUMBER.format(numeric), unit) }
    }
    case 'boolean':
      return { kind: 'boolean', value: Boolean(value), text: value ? 'Yes' : 'No' }
    case 'datetime': {
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return { kind: 'datetime', absolute: value, relative: value }
      // Epoch milliseconds, because that is what every other timestamp on this wire is. Both forms
      // are returned rather than one: the age is what a person reads and the absolute time is what
      // they check, so the age is the label and the absolute time is the tooltip.
      const at = typeof value === 'string' && Number.isNaN(Number(value)) ? Date.parse(value) : Number(value)
      if (!Number.isFinite(at)) return EMPTY
      return {
        kind: 'datetime',
        absolute: new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', ...(field.zone ? { timeZone: field.zone } : {}) }),
        relative: formatRelativeTime(at, now),
      }
    }
    case 'enum': {
      const id = String(value)
      const declared = field.values?.find((candidate) => candidate.id === id)
      // A value the schema never declared still renders. A query-shaped source can't always know
      // its values ahead of the data; it just can't be pre-toned or pre-ordered.
      return { kind: 'enum', label: declared?.label ?? id, tone: declared?.tone ?? 'muted', icon: declared?.icon }
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
    case 'list':
      return cell.items.map(cellText).join(', ')
    default:
      return cell.text
  }
}
