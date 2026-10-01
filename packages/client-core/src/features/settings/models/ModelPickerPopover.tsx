import { Show, type JSX } from 'solid-js'
import { Button } from '../../../kit/components/inputs/Button'
import Icon from '../../../kit/components/content/Icon'
import { Inline } from '../../../kit/components/layout/Inline'
import { Stack } from '../../../kit/components/layout/Stack'
import { SectionHeader } from '../../../kit/components/layout/SectionHeader'
import Popover from '../../../kit/components/overlays/Popover'

/** The compact model-choice surface shared by message composers. The choices themselves stay with
 *  their owner: text generation uses model backends, while an agent chat uses agent providers. */
export default function ModelPickerPopover(props: {
  label?: string
  title: string
  /** The tip's second line, such as the choice in force. */
  tipSub?: string
  sparkle?: boolean
  above?: JSX.Element
  children: JSX.Element
}) {
  return (
    <Popover
      placement="top-start"
      role="dialog"
      ariaLabel={props.label ?? 'Model for the message'}
      minWidth={220}
      trigger={({ open, toggle }) => (
        <Button
          variant="bare"
          size="sm"
          iconOnly={!props.sparkle}
          label={props.label ?? 'Model for the message'}
          tip={props.title}
          tipSub={props.tipSub}
          opens="dialog"
          expanded={open()}
          onPress={toggle}
        >
          <Show when={props.sparkle} fallback={<Icon name="chevron-down" />}>
            <Inline gap="none"><Icon name="sparkles" /><Icon name="chevron-down" /></Inline>
          </Show>
        </Button>
      )}
    >
      <Stack gap="row">
        {props.above}
        <SectionHeader level="group">Model for the message</SectionHeader>
        {props.children}
      </Stack>
    </Popover>
  )
}
