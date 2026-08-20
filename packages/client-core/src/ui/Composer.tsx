import { Show, type JSX } from 'solid-js'
import { cx } from './cx'
import MentionTextarea from './MentionTextarea'
import { Alert, Button, Textarea, Toolbar } from './primitives'

// The comment box: textarea, submit, error line, and the Cmd+Enter chord, which github documented only
// inside a placeholder string.
//
// `mentions` decides which textarea renders. The mention data sources are host-side, so a frame leaves
// the prop unset and gets a plain Textarea. Making that a prop rather than a runtime check keeps the
// difference legible at the call site.
export function Composer(props: {
  value: string
  onInput: (value: string) => void
  onSubmit: () => void
  busy?: boolean
  disabled?: boolean
  error?: string
  placeholder?: string
  submitLabel?: string
  /** A Cancel button, a "resolve thread" checkbox, rendered before submit. */
  secondary?: JSX.Element
  /** Logins to complete on `@`. Unset renders a plain Textarea. */
  mentions?: string[]
  /** A visible chord hint. Compose from Kbd. */
  hint?: JSX.Element
  rows?: number
  class?: string
}) {
  const submit = () => {
    if (props.busy || props.disabled || !props.value.trim()) return
    props.onSubmit()
  }
  // Cmd+Enter on macOS, Ctrl+Enter elsewhere. Implemented once, here.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
    event.preventDefault()
    submit()
  }

  return (
    <div class={cx('ui-composer', props.class)}>
      <Show
        when={props.mentions}
        fallback={
          <Textarea
            class="ui-composer-input"
            rows={props.rows ?? 3}
            placeholder={props.placeholder}
            disabled={props.disabled}
            value={props.value}
            onInput={(event) => props.onInput(event.currentTarget.value)}
            onKeyDown={onKeyDown}
          />
        }
      >
        {(mentions) => (
          <MentionTextarea
            class="ui-input ui-composer-input"
            placeholder={props.placeholder}
            disabled={props.disabled}
            value={props.value}
            mentions={mentions()}
            onInput={props.onInput}
            onKeyDown={onKeyDown}
          />
        )}
      </Show>
      <Show when={props.error}><Alert>{props.error}</Alert></Show>
      <Toolbar variant="actions" class="ui-composer-actions">
        <Show when={props.hint}><span class="ui-composer-hint muted">{props.hint}</span></Show>
        <Toolbar.Spacer />
        <Show when={props.secondary}>{props.secondary}</Show>
        <Button
          variant="solid"
          tone="accent"
          busy={props.busy}
          disabled={props.disabled || !props.value.trim()}
          onClick={submit}
        >
          {props.submitLabel ?? 'Comment'}
        </Button>
      </Toolbar>
    </div>
  )
}
