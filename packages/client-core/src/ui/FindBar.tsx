import { Show, type JSX } from 'solid-js'
import Icon from './Icon'
import { Button, Input, Toolbar } from './primitives'

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
export function FindBar(props: {
  query: string
  onQuery: (query: string) => void
  /** Renders "3/17". Omit while idle; a 0/0 reads as a failed search rather than an unused one. */
  count?: { current: number; total: number }
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
  return (
    <Toolbar size="sm" ariaLabel="Find">
      <div class="ui-findbar-search" role="search">
        <Input
          ref={props.ref}
          kind="filter"
          size="sm"
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
      <Show when={props.count}>
        {/* Polite, not assertive: the count changes on every keystroke. */}
        {(count) => (
          <span class="ui-findbar-count" aria-live="polite">
            {count().total ? `${count().current}/${count().total}` : 'No matches'}
          </span>
        )}
      </Show>
      <Show when={props.status}><span class="ui-findbar-status muted">{props.status}</span></Show>
      <Toolbar.Group>
        <Button
          variant="bare"
          size="sm"
          iconOnly
          disabled={!props.count?.total}
          tip="Previous match"
          tipKey="⇧⏎"
          label="Previous match"
          onPress={() => props.onPrev()}
        >
          <Icon name="chevron-up" />
        </Button>
        <Button
          variant="bare"
          size="sm"
          iconOnly
          disabled={!props.count?.total}
          tip="Next match"
          tipKey="⏎"
          label="Next match"
          onPress={() => props.onNext()}
        >
          <Icon name="chevron-down" />
        </Button>
      </Toolbar.Group>
      <Show when={props.toggles}>{props.toggles}</Show>
      <Show when={props.onClose}>
        <Button variant="bare" size="sm" iconOnly tip="Close find" tipKey="Esc" label="Close find" onPress={() => props.onClose?.()}>
          <Icon name="x" />
        </Button>
      </Show>
    </Toolbar>
  )
}
