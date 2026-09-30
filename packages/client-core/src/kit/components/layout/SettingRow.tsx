import { createUniqueId, Show, type JSX } from 'solid-js'
import { createSavedSignal } from '../../lib/controls/savedSignal'
import { Button } from '../inputs/Button'

export type SettingRowProps = {
  label: string
  description?: string
  /** `inline` puts the control to the right of the label. `stacked` puts it under the label at the
   *  full width, for a text area, a script, or a table. */
  layout?: 'inline' | 'stacked'
  /** Where the value is set instead, such as `.acorn/config.toml`. The row says **From …** and the
   *  control goes read-only, still showing the value this machine holds underneath. */
  from?: string
  /** Where the value is stored, when that differs from the page it sits on: a row this device keeps on
   *  a page about the node. The row carries its own **This device** chip beside the label, the one the
   *  header shows for a device page. `device` is the only such row today. */
  scope?: 'device'
  /** When the last write landed, as `Date.now()`. The row shows **Saved** for about two seconds after
   *  each new value. A number rather than a flag so the row owns the timer and every page's signal
   *  lasts the same time. */
  savedAt?: number
  /** Why the last write failed. The control keeps what was typed; that is the caller's draft. */
  error?: string
  /** Given only while the value differs from a known default. The row marks the label with a dot and
   *  offers **Reset**, which calls this. A shell-side handler: a remote tree cannot send it, because
   *  it is not one of the kit's twelve events. */
  onReset?: () => void
  children?: JSX.Element
}

/* SettingRow: one setting on a settings page. The label and one line of description on the left, the
   control on the right, or under them at the full width when `stacked`.

   A group rather than a <label>: a row can hold more than one control, and a label wrapping two of
   them points at the first (./Field.tsx says the same). Each control keeps its own accessible name.

   The control sits in a disabled <fieldset> while the value comes from somewhere else, which turns
   every input, select and button inside it inert without the row reaching into its child.

   At 80×24: one line, the label then the control; `stacked` puts the control on the next line. The
   description in grey under it, **Saved** in green or the error in red after it. A device row on a
   node page says `(this device)` after its label. */
export function SettingRow(props: SettingRowProps) {
  const labelId = createUniqueId()
  const descriptionId = createUniqueId()
  const saved = createSavedSignal(() => props.savedAt)
  return (
    <div
      class="ui-setting-row"
      data-layout={props.layout ?? 'inline'}
      data-from={props.from ? '' : undefined}
      role="group"
      aria-labelledby={labelId}
      aria-describedby={props.description ? descriptionId : undefined}
    >
      <div class="ui-setting-text">
        <span class="ui-setting-label" id={labelId}>
          {props.label}
          <Show when={props.onReset}><span class="ui-setting-changed" title="Changed from the default">•</span></Show>
          {/* The space keeps the row's accessible name two words apart: "Tool call display This device". */}
          <Show when={props.scope === 'device'}>{' '}<span class="ui-setting-scope">This device</span></Show>
        </span>
        <Show when={props.description}><span class="ui-setting-description" id={descriptionId}>{props.description}</span></Show>
        <Show when={props.from}><span class="ui-setting-from">From {props.from}</span></Show>
      </div>
      <div class="ui-setting-control">
        <fieldset class="ui-setting-fieldset" disabled={!!props.from}>{props.children}</fieldset>
        <span class="ui-setting-status" aria-live="polite">{saved() && !props.error ? 'Saved' : ''}</span>
        <Show when={props.onReset && !props.from}>
          <Button variant="bare" size="sm" onPress={() => props.onReset?.()}>Reset</Button>
        </Show>
      </div>
      <Show when={props.error}><span class="ui-setting-error" role="alert">{props.error}</span></Show>
    </div>
  )
}
