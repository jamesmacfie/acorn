import { createUniqueId, Show, type JSX } from 'solid-js'
import { createSavedSignal } from '../../lib/controls/savedSignal'
import { Button } from '../inputs/Button'
import { Badge } from '../content/Badge'
import { HelpMark } from '../content/HelpMark'
import { createFieldSlot, FieldProvider } from '../inputs/controlAttrs'

export type SettingRowProps = {
  label: string
  /** What the person needs to choose right now: a consequence that cannot be undone, a unit, a
   *  format. One line. */
  description?: string
  /** How it works, when it applies, why it exists. Behind a "?" after the label, because it is not
   *  needed at a glance (docs/frontend.md § Pages and the save model). */
  help?: string
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

   A group, because a row can hold more than one control. The label is a <label for> the one control a
   row usually holds, which claims the id itself (../inputs/controlAttrs.ts), so clicking "Play a sound"
   flips its switch. A row with two controls leaves each with its own name.

   The control sits in a disabled <fieldset> while the value comes from somewhere else, which turns
   every input, select and button inside it inert without the row reaching into its child.

   The save state sits on the title line, after the label and its help mark: the changed dot, the
   scope chip, then **Saved** or **Reset** in one spot. The control column holds the control and nothing else, so the
   control never moves or narrows while a save lands.

   At 80×24: one line, the label then the control; `stacked` puts the control on the next line. The
   description and the help in grey under it, **Saved** in green or the error in red after it. A
   device row on a node page says `(this device)` after its label. */
export function SettingRow(props: SettingRowProps) {
  const labelId = createUniqueId()
  const scopeId = createUniqueId()
  const descriptionId = createUniqueId()
  const slot = createFieldSlot(() => (props.description ? descriptionId : undefined))
  const saved = createSavedSignal(() => props.savedAt)
  const showSaved = () => saved() && !props.error
  return (
    <div
      class="ui-setting-row"
      data-layout={props.layout ?? 'inline'}
      data-from={props.from ? '' : undefined}
      role="group"
      // The name is the label and the scope chip, "Tool call display This device", never the dot.
      aria-labelledby={props.scope === 'device' ? `${labelId} ${scopeId}` : labelId}
      aria-describedby={props.description ? descriptionId : undefined}
    >
      <div class="ui-setting-text">
        <span class="ui-setting-title">
          <Show
            when={props.help}
            fallback={<label class="ui-setting-label" id={labelId} for={slot.target()}>{props.label}</label>}
          >
            {(help) => (
              <span class="ui-titled">
                <label class="ui-setting-label" id={labelId} for={slot.target()}>{props.label}</label>
                <HelpMark text={help()} titleId={labelId} />
              </span>
            )}
          </Show>
          <Show when={props.onReset}><span class="ui-setting-changed" data-tip="Changed from the default">•</span></Show>
          <Show when={props.scope === 'device'}><span class="ui-setting-scope" id={scopeId}><Badge size="xs">This device</Badge></span></Show>
          <span class="ui-setting-status" aria-live="polite">{showSaved() ? 'Saved' : ''}</span>
          <Show when={props.onReset && !props.from && !showSaved()}>
            <Button variant="ghost" size="xs" onPress={() => props.onReset?.()}>Reset</Button>
          </Show>
        </span>
        <Show when={props.description}><span class="ui-setting-description" id={descriptionId}>{props.description}</span></Show>
        <Show when={props.from}><span class="ui-setting-from">From {props.from}</span></Show>
      </div>
      <div class="ui-setting-control">
        <fieldset class="ui-setting-fieldset" disabled={!!props.from}>
          <FieldProvider value={slot.claim}>{props.children}</FieldProvider>
        </fieldset>
      </div>
      <Show when={props.error}><span class="ui-setting-error" role="alert">{props.error}</span></Show>
    </div>
  )
}
