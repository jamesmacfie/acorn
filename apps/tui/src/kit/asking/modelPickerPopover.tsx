/** @jsxImportSource @acorn/tui/jsx */
import type { JSX } from 'solid-js'
import { Popover } from '../grouping/popover'
import { Stack } from '../grouping/blocks'
import { Text } from '../showing/text'
import { Button } from './buttons'

/** The terminal projection of the compact message-model picker. Buttons use their text here, so
 *  the desktop sparkle is represented by the same named control. */
export function ModelPickerPopover(props: {
  label?: string
  title: string
  /** The desktop tip's second line. A terminal has no hover, so it is accepted and not drawn. */
  tipSub?: string
  sparkle?: boolean
  above?: JSX.Element
  children: JSX.Element
}) {
  const label = () => props.label ?? 'Model for the message'
  return (
    <Popover
      role="dialog"
      ariaLabel={label()}
      trigger={({ open, toggle }) => (
        <Button variant="bare" size="sm" label={label()} title={props.title}
          opens="dialog" expanded={open()} onPress={toggle} />
      )}
    >
      <Stack gap="row">
        {props.above}
        <Text emphasis="eyebrow">Model for the message</Text>
        {props.children}
      </Stack>
    </Popover>
  )
}
