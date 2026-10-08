import { children, Show, type JSX } from 'solid-js'
import { IconButton } from './IconButton'
import { Toolbar } from '../layout/Toolbar'
import { formatChord } from '../../lib/rendering/formatChord'
import { Input } from './Input'

// The in-content search strip. Three surfaces had one and all three disagreed on the keyboard
// contract; this owns it so they finally agree:
//
//   Enter        next match
//   Shift+Enter  previous match
//   Escape       close
//
// Matching and highlighting stay entirely at the call site; the bar is chrome. What it also
// standardises is the highlight class: `.ui-find-mark` (plus `[data-current]`) replaces three
// separate vocabularies, and callers put it on their own <mark> elements.
/** "3/17", "17 matches" when the selection is on none of them, "1000+" when counting stopped. */
function findCountText(count: { current: number; total: number; more?: boolean }): string {
  if (!count.total) return 'No matches'
  const total = `${count.total}${count.more ? '+' : ''}`
  if (count.current) return `${count.current}/${total}`
  return `${total} ${count.total === 1 && !count.more ? 'match' : 'matches'}`
}

export function FindBar(props: {
  query: string
  onQuery: (query: string) => void
  /** Renders "3/17". Omit while idle; a 0/0 reads as a failed search rather than an unused one. A
   *  `current` of 0 means the selection is not on a match, and `more` means counting stopped early. */
  count?: { current: number; total: number; more?: boolean }
  /** Why the query cannot run, such as an invalid regular expression. Shown in the count's place. */
  error?: string
  onNext: () => void
  onPrev: () => void
  onClose?: () => void
  /** ToggleButtons or a SegmentedControl: case, whole-word, regex, follow. */
  toggles?: JSX.Element
  /** A live note beside the count: docker's stream state, the editor's truncation warning. */
  status?: JSX.Element
  placeholder?: string
  ref?: HTMLInputElement | ((element: HTMLInputElement) => void)
}) {
  // Read once, for the reason on RowParts (../layout/Row.tsx).
  const status = children(() => props.status)
  const toggles = children(() => props.toggles)
  return (
    <Toolbar size="sm" ariaLabel="Find">
      <div class="ui-findbar-search" role="search">
        <Input
          ref={props.ref}
          kind="filter"
          label="Find"
          invalid={!!props.error}
          assist={false}
          placeholder={props.placeholder ?? 'Find…'}
          value={props.query}
          onInput={(value) => props.onQuery(value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && props.onClose) {
              event.preventDefault()
              return props.onClose()
            }
            if (event.key !== 'Enter') return
            event.preventDefault()
            if (event.shiftKey) props.onPrev()
            else props.onNext()
          }}
        />
      </div>
      {/* Polite, not assertive: the count changes on every keystroke. */}
      <Show when={props.error ?? (props.count && findCountText(props.count))}>
        {(text) => <span class="ui-findbar-count" data-error={props.error ? '' : undefined} aria-live="polite">{text()}</span>}
      </Show>
      <Show when={status()}><span class="ui-findbar-status muted">{status()}</span></Show>
      <Toolbar.Group>
        <IconButton
          icon="chevron-up"
          disabled={!props.count?.total}
          tip="Previous match"
          tipKey={formatChord('shift+enter')}
          label="Previous match"
          onPress={() => props.onPrev()}
        />
        <IconButton
          icon="chevron-down"
          disabled={!props.count?.total}
          tip="Next match"
          tipKey={formatChord('enter')}
          label="Next match"
          onPress={() => props.onNext()}
        />
      </Toolbar.Group>
      <Show when={toggles()}>{toggles()}</Show>
      <Show when={props.onClose}>
        <IconButton icon="x" tip="Close find" tipKey={formatChord('escape')} label="Close find" onPress={() => props.onClose?.()} />
      </Show>
    </Toolbar>
  )
}
