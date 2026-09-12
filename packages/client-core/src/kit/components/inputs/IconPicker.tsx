import { onMount } from 'solid-js'
import Picker from './Picker'
import Icon from '../content/Icon'
import { iconNames, loadIconNodes } from '../../tokens/iconNodes'
import { fuzzyScore } from '../../lib/fuzzy'

const MAX_RESULTS = 200

// An unfiltered popover of 1756 names alphabetically would open on a-arrow-down, a-arrow-up,
// a-large-small, and so on: technically complete, useless in practice. These are what an empty
// query shows.
const LEAD = [
  'circle-dot', 'git-pull-request', 'bug', 'wrench', 'rocket', 'flame', 'zap', 'star',
  'flask-conical', 'beaker', 'microscope', 'shield', 'lock', 'key', 'database', 'server',
  'globe', 'terminal', 'code', 'file-text', 'book-open', 'paintbrush', 'sparkles', 'brain',
  'hammer', 'settings', 'gauge', 'trending-up', 'clock', 'calendar', 'flag', 'target',
]

// Whatever is drawable at the moment it is asked: the eager 87 before the full set has arrived, all
// 1,756 after. The rail loads the set when it mounts, so by the time anyone reaches the dice this is
// the whole list.
export const randomIconName = (): string => {
  const names = iconNames()
  return names[Math.floor(Math.random() * names.length)]
}

export default function IconPicker(props: {
  value: string | null
  /** Shown when `value` is null: the caller's derived default (e.g. the task's origin icon). */
  fallback: string
  onSelect: (icon: string | null) => void
  disabled?: boolean
}) {
  // The picker is the one surface that has to see every name, and the one where a row drawing its own
  // text instead of its icon would be the point of the screen missed. Awaited here rather than at the
  // call site: opening this popover is the moment the full set is worth its 371 KB
  // (tokens/iconNodes.ts).
  onMount(() => void loadIconNodes())

  const results = (query: string) => {
    const q = query.trim()
    if (!q) return LEAD
    return iconNames().map((name) => ({ name, score: fuzzyScore(q, name) }))
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
