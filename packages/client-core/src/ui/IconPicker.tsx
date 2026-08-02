import Picker from './Picker'
import Icon, { ICON_NAMES } from './Icon'
import { fuzzyScore } from '../palette/model'

// Pick a Lucide icon by name, with a die-roll for "any old icon". Wraps the shared Picker, so it
// inherits the portalled popover, filter input and dismiss behaviour.
//
// ponytail: the filtered list is capped — Picker renders plain rows with no virtualization, and all
// 1756 names at once would jank. Raise the cap only alongside virtualizing .repo-picker-list.
const MAX_RESULTS = 200

// An unfiltered popover of 1756 names alphabetically would open on a-arrow-down, a-arrow-up,
// a-large-small… — technically complete, useless in practice. These are what an empty query shows.
const LEAD = [
  'circle-dot', 'git-pull-request', 'bug', 'wrench', 'rocket', 'flame', 'zap', 'star',
  'flask-conical', 'beaker', 'microscope', 'shield', 'lock', 'key', 'database', 'server',
  'globe', 'terminal', 'code', 'file-text', 'book-open', 'paintbrush', 'sparkles', 'brain',
  'hammer', 'settings', 'gauge', 'trending-up', 'clock', 'calendar', 'flag', 'target',
]

export const randomIconName = (): string => ICON_NAMES[Math.floor(Math.random() * ICON_NAMES.length)]

export default function IconPicker(props: {
  value: string | null
  /** Shown when `value` is null — the caller's derived default (e.g. the task's origin icon). */
  fallback: string
  onSelect: (icon: string | null) => void
  disabled?: boolean
}) {
  const results = (query: string) => {
    const q = query.trim()
    if (!q) return LEAD
    return ICON_NAMES.map((name) => ({ name, score: fuzzyScore(q, name) }))
      .filter((x): x is { name: string; score: number } => x.score !== null)
      // Tie-break on brevity: for "bug", `bug` should beat `bug-play` and `bug-off`.
      .sort((a, b) => b.score - a.score || a.name.length - b.name.length)
      .slice(0, MAX_RESULTS)
      .map((x) => x.name)
  }

  return (
    <Picker<string>
      label={<Icon name={props.value ?? props.fallback} />}
      placeholder="Filter icons…"
      emptyText="No icon matches."
      results={results}
      rowLabel={(name) => name}
      isActive={(name) => name === props.value}
      onSelect={props.onSelect}
      leading={(name) => <Icon name={name} />}
      disabled={props.disabled}
      tools={
        <>
          <button type="button" class="repo-picker-refresh" title="Random icon" aria-label="Random icon" onClick={() => props.onSelect(randomIconName())}>
            <Icon name="dices" />
          </button>
          <button
            type="button"
            class="repo-picker-refresh"
            title="Use the default icon"
            aria-label="Use the default icon"
            disabled={!props.value}
            onClick={() => props.onSelect(null)}
          >
            <Icon name="rotate-ccw" />
          </button>
        </>
      }
    />
  )
}
