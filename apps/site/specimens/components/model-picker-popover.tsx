import { Button, Inline, ModelBackendPicker, ModelPickerPopover, ToolbarSpacer } from 'acorn-plugin-sdk/remote'
import type { SpecimenMeta } from '../specimen'

export const meta: SpecimenMeta = {
  title: 'ModelPickerPopover',
  caption: 'The ✦ model picker at the start of a dialog’s actions, shut.',
  terminal: { columns: 60, rows: 1 },
  width: 480,
}

export default function ModelPickerPopoverSpecimen() {
  return (
    <Inline>
      <ModelPickerPopover
        sparkle
        label="Model for the guide"
        title="Choose who writes the guide"
        tipSub="Claude Code, Opus"
      >
        <ModelBackendPicker
          backendId="harness:claude"
          modelId="opus"
          backends={[
            {
              id: 'harness:claude',
              kind: 'harness',
              label: 'Claude Code',
              defaultModelId: '',
              models: [
                { id: 'opus', label: 'Opus' },
                { id: 'sonnet', label: 'Sonnet' },
              ],
            },
          ]}
          onChange={() => {}}
        />
      </ModelPickerPopover>
      <ToolbarSpacer />
      <Button variant="solid">Generate</Button>
    </Inline>
  )
}
