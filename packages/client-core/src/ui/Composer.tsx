import { createEffect, createSignal, on, Show, type JSX } from 'solid-js'
import { bindIntents } from '../keys/host'
import MentionTextarea from './MentionTextarea'
import { Alert, Button, Textarea, Toolbar } from './primitives'

// The comment box: textarea, submit, error line, and the Cmd+Enter chord, which github documented only
// inside a placeholder string.
//
// `mentions` decides which textarea renders. The mention data sources are host-side, so a frame leaves
// the prop unset and gets a plain Textarea. Making that a prop rather than a runtime check keeps the
// difference legible at the call site.
//
// The live text is held here, not by the caller, and `onSubmit` carries it. That is what makes the
// composer usable from a remote tree, where a per-keystroke `onInput` cannot cross — every key would
// be a message hop, so the kit refuses to send one (docs/future/layout/06-remote-tree.md § Inputs,
// state, and the message hop). A caller that wants each keystroke still gets `onInput`; a caller that
// only wants the text on submit can leave it unset and read the argument.
export function Composer(props: {
  value: string
  onInput?: (value: string) => void
  onSubmit: (value: string) => void
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
}) {
  // Seeded from the prop and re-seeded whenever it changes, so a caller that does hold the value stays
  // the source of truth and a caller that does not still has a working field.
  const [live, setLive] = createSignal(props.value)
  createEffect(on(() => props.value, (value) => setLive(value)))
  const type = (value: string): void => {
    setLive(value)
    props.onInput?.(value)
  }

  const submit = () => {
    const value = live()
    if (props.busy || props.disabled || !value.trim()) return
    props.onSubmit(value)
    // Cleared here rather than left to the caller, because a caller that never heard the keystrokes
    // has nothing to clear. Every caller that does hold the value clears it on submit too, so the two
    // agree.
    setLive('')
    return true
  }

  return (
    // The composer owns its keys while focused, except for `commit`: Cmd+Enter on macOS and
    // Ctrl+Enter elsewhere, which is one row of ../keys/keymap.ts rather than a chord spelled here.
    <div
      class="ui-composer"
      ref={(el) => bindIntents(el, ['commit'], () => submit() === true)}
    >
      <Show
        when={props.mentions}
        fallback={
          <Textarea
            rows={props.rows ?? 3}
            placeholder={props.placeholder}
            disabled={props.disabled}
            value={live()}
            onInput={type}
          />
        }
      >
        {(mentions) => (
          <MentionTextarea
            placeholder={props.placeholder}
            disabled={props.disabled}
            value={live()}
            mentions={mentions()}
            onInput={type}
          />
        )}
      </Show>
      <Show when={props.error}><Alert>{props.error}</Alert></Show>
      <Toolbar variant="actions">
        <Show when={props.hint}><span class="ui-composer-hint muted">{props.hint}</span></Show>
        <Toolbar.Spacer />
        <Show when={props.secondary}>{props.secondary}</Show>
        <Button
          variant="solid"
          tone="accent"
          busy={props.busy}
          disabled={props.disabled || !live().trim()}
          onPress={submit}
        >
          {props.submitLabel ?? 'Comment'}
        </Button>
      </Toolbar>
    </div>
  )
}
