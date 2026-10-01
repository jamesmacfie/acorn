/** @jsxImportSource @acorn/tui/jsx */
import { Show } from 'solid-js'
import type { SettingRowProps, SettingsSectionProps } from '@acorn/client-core/kit/components/layout'
import { createSavedSignal } from '@acorn/client-core/kit/lib/savedSignal'
import { Line, slot } from '../cells'
import { spaceLines } from '../roles'
import { Button } from '../asking/buttons'

/** The label in bold, the description and the help in grey under it, then the rows. The danger zone's label is in
 *  the danger colour, because a frame round it would cost two lines of a 24-line screen. */
export function SettingsSection(props: SettingsSectionProps) {
  return (
    <box flexDirection="column" flexShrink={0} marginTop={spaceLines('section')}>
      <box flexDirection="row" gap={1} flexShrink={0}>
        <Line role="strong" {...(props.tone ? { tone: props.tone } : {})}>{props.label}</Line>
      </box>
      <Show when={props.actions}>{slot(props.actions)}</Show>
      <Show when={props.description}><Line role="muted" wrap>{props.description!}</Line></Show>
      {/* No hover here to hide the help behind, so it prints where the description does. */}
      <Show when={props.help}><Line role="muted" wrap>{props.help!}</Line></Show>
      {props.children}
    </box>
  )
}

/** One line: the label, then the control; `stacked` puts the control on the line under it. A value
 *  set somewhere else draws where and no control, because this host has no read-only form of an
 *  arbitrary child and a control that still takes keys would write a value that has no effect. */
export function SettingRow(props: SettingRowProps) {
  const saved = createSavedSignal(() => props.savedAt)
  return (
    <box flexDirection="column" flexShrink={0}>
      <box flexDirection={props.layout === 'stacked' ? 'column' : 'row'} gap={props.layout === 'stacked' ? 0 : 1} flexShrink={0}>
        <Line>{`${props.label}${props.onReset ? ' •' : ''}`}</Line>
        <Show when={props.scope === 'device'}><Line role="muted">(this device)</Line></Show>
        <Show when={props.from} fallback={props.children}>
          <Line role="muted">{`From ${props.from}`}</Line>
        </Show>
        <Show when={saved() && !props.error}><Line tone="ok">Saved</Line></Show>
        <Show when={props.onReset && !props.from}>
          <Button variant="bare" label="Reset" onPress={() => props.onReset?.()}>Reset</Button>
        </Show>
      </box>
      <Show when={props.description}><Line role="muted" wrap>{props.description!}</Line></Show>
      <Show when={props.help}><Line role="muted" wrap>{props.help!}</Line></Show>
      <Show when={props.error}><Line tone="danger" wrap>{props.error!}</Line></Show>
    </box>
  )
}
