import type { PluginCollectionCell, PluginCollectionField } from '@acorn/protocol/collections.ts'
import { isPluginOpenableUrl } from '@acorn/protocol/externalUrl.ts'
import { formatRelativeTime } from '../lib/formatRelativeTime'
import type { PanelTone } from './model'

// Rendering a cell BY ITS SEMANTIC TYPE, which is the whole point of the type vocabulary being
// semantic rather than primitive (@acorn/protocol/collections.ts): `datetime` gets an age, `enum`
// gets a toned chip, `number` gets the unit its field declared. A plugin that answered with strings
// would have to draw all of that itself, which is the frame tier.
//
// Every hint comes off the FIELD, never off the panel. That is what makes a view switch lossless —
// a unit written on a table's column config is gone the moment the panel becomes a list.
//
// Pure, and returning a description rather than JSX, for the reason shaping.ts gives: the component
// that draws this cannot be tested in this repo, so the decisions live where they can be.

export type FormattedCell =
  | { kind: 'empty' }
  | { kind: 'text'; text: string }
  | { kind: 'number'; text: string }
  | { kind: 'boolean'; value: boolean; text: string }
  | { kind: 'datetime'; absolute: string; relative: string }
  | { kind: 'enum'; label: string; tone: PanelTone }
  | { kind: 'person'; name: string }
  | { kind: 'link'; url: string; text: string }

const EMPTY: FormattedCell = { kind: 'empty' }

/** `%` reads wrong with a space and every other unit reads wrong without one. */
const withUnit = (text: string, unit: string | undefined): string =>
  unit === undefined ? text : unit === '%' ? `${text}%` : `${text} ${unit}`

export function formatCell(
  field: PluginCollectionField,
  value: PluginCollectionCell | undefined,
  now = Date.now(),
): FormattedCell {
  // `null` is "this row has no value here", which the wire distinguishes from an empty string on
  // purpose. Both draw as nothing; only the sort order tells them apart (shaping.ts).
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
      // A value the schema never declared still renders — a query-shaped collection cannot always
      // know its values ahead of the data — it just cannot be pre-toned or pre-ordered.
      return { kind: 'enum', label: declared?.label ?? id, tone: declared?.tone ?? 'muted' }
    }
    case 'person':
      // A name. The avatar wants an identity the wire does not carry: `person` is a display string,
      // not a resolved account, and inventing a gravatar from it would be a guess rendered as fact.
      return { kind: 'person', name: String(value) }
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
