import { createSignal, For, onCleanup } from 'solid-js'
import type { PickedFile } from '../../infra/platform'
import type { WorkspaceImageCrop } from '@acorn/protocol/workspaceAppearance.ts'
import { Button } from '../../kit/components/primitives'
import { Field } from '../../kit/components/inputs/Field'
import { WorkspaceIcon } from './WorkspaceIcon'

export type WorkspaceImageDraft = { file: PickedFile; url: string; width: number; height: number }

export function WorkspaceImageCrop(props: { draft: WorkspaceImageDraft; name: string; busy: boolean; save: (crop: WorkspaceImageCrop) => void; cancel: () => void }) {
  const [x, setX] = createSignal(0.5)
  const [y, setY] = createSignal(0.5)
  const [size, setSize] = createSignal(1)
  onCleanup(() => URL.revokeObjectURL(props.draft.url))
  const side = () => Math.max(1, Math.round(size() * Math.min(props.draft.width, props.draft.height)))
  const preview = () => ({
    width: `${props.draft.width * 160 / side()}px`, height: `${props.draft.height * 160 / side()}px`,
    left: `${-Math.round((props.draft.width - side()) * x()) * 160 / side()}px`,
    top: `${-Math.round((props.draft.height - side()) * y()) * 160 / side()}px`,
  })
  const tilePreview = () => ({
    position: 'absolute' as const, width: `${props.draft.width * 100 / side()}%`, height: `${props.draft.height * 100 / side()}%`,
    left: `${-Math.round((props.draft.width - side()) * x()) * 100 / side()}%`,
    top: `${-Math.round((props.draft.height - side()) * y()) * 100 / side()}%`,
  })
  return (
    <div class="workspace-icon-editor">
      <div class="workspace-image-crop" aria-label="Square crop preview"><img src={props.draft.url} alt="" style={preview()} /></div>
      <div class="workspace-icon-previews"><For each={['rail', 'switcher'] as const}>{(size) => <WorkspaceIcon name={props.name} size={size} appearance={{ version: 1, kind: 'image', imageId: '0'.repeat(64) }} imageUrl={props.draft.url} imageStyle={tilePreview()} />}</For></div>
      <Field label="Zoom" group><input aria-label="Crop zoom" type="range" min="0.1" max="1" step="0.01" value={1.1 - size()} disabled={props.busy} onInput={(e) => setSize(1.1 - Number(e.currentTarget.value))} /></Field>
      <Field label="Horizontal position" group><input aria-label="Crop horizontal position" type="range" min="0" max="1" step="0.01" value={x()} disabled={props.busy} onInput={(e) => setX(Number(e.currentTarget.value))} /></Field>
      <Field label="Vertical position" group><input aria-label="Crop vertical position" type="range" min="0" max="1" step="0.01" value={y()} disabled={props.busy} onInput={(e) => setY(Number(e.currentTarget.value))} /></Field>
      <div class="workspace-icon-controls">
        <Button variant="solid" disabled={props.busy} onPress={() => props.save({ x: x(), y: y(), size: size() })}>Save image</Button>
        <Button variant="ghost" disabled={props.busy} onPress={props.cancel}>Cancel</Button>
      </div>
    </div>
  )
}
