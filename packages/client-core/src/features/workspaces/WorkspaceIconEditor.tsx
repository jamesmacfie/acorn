import { createSignal, For, onCleanup, Show } from 'solid-js'
import type { Workspace } from '@acorn/protocol/api.ts'
import {
  resolveWorkspaceAppearance, WORKSPACE_IMAGE_PIXELS, WORKSPACE_IMAGE_UPLOAD_BYTES,
  type WorkspaceAppearance, type WorkspaceImageCrop as ImageCrop,
} from '@acorn/protocol/workspaceAppearance.ts'
import { resolveProjectColor } from '@acorn/protocol/projectColor.ts'
import { activeNodeId } from '../../infra/node/activeNode'
import { pickFiles } from '../../infra/platform'
import { Button, Select } from '../../kit/components/primitives'
import IconPicker from '../../kit/components/inputs/IconPicker'
import { SettingRow } from '../../kit/components/layout/SettingRow'
import { createSettingSave } from '../settings/settingSave'
import { useUnsavedChanges } from '../settings/unsavedChanges'
import { setWorkspaceAppearance, uploadWorkspaceImage } from './workspaceMutations'
import { WorkspaceIdentity } from './WorkspaceIcon'
import { WorkspaceImageCrop, type WorkspaceImageDraft } from './WorkspaceImageCrop'

const defaultIcon = (): WorkspaceAppearance & { kind: 'icon' } => ({ version: 1, kind: 'icon', icon: 'circle-dot', background: { kind: 'solid', color: 'blue' } })

export function WorkspaceIconEditor(props: { workspace: Workspace }) {
  const save = createSettingSave()
  const [busy, setBusy] = createSignal(false)
  const [mode, setMode] = createSignal(props.workspace.appearance?.kind === 'image' ? 'image' : 'icon')
  const [draft, setDraft] = createSignal<WorkspaceAppearance | null>()
  const [image, setImage] = createSignal<WorkspaceImageDraft>()
  const appearance = () => draft() === undefined ? resolveWorkspaceAppearance(props.workspace.appearance) : draft()
  const icon = () => { const value = appearance(); return value?.kind === 'icon' ? value : defaultIcon() }
  useUnsavedChanges(() => !!image())
  let pendingUrl: string | undefined
  let disposed = false
  onCleanup(() => { disposed = true; if (pendingUrl) URL.revokeObjectURL(pendingUrl) })

  const commit = async (value: WorkspaceAppearance | null) => {
    if (busy()) return false
    const nodeId = activeNodeId()
    if (!nodeId) return false
    setDraft(value)
    setBusy(true)
    try {
      const saved = await save.run(async () => {
        await setWorkspaceAppearance(props.workspace.id, value, nodeId)
      })
      if (saved) setDraft(undefined)
      return saved
    } finally { setBusy(false) }
  }
  const chooseImage = async () => {
    if (busy()) return
    setBusy(true)
    try {
      await save.run(async () => {
        const file = (await pickFiles({ accept: ['png', 'jpg', 'jpeg', 'webp'] }))[0]
        if (!file || disposed) return
        if (file.bytes.length > WORKSPACE_IMAGE_UPLOAD_BYTES) throw new Error('Choose an image under 5 MiB.')
        const url = URL.createObjectURL(new Blob([file.bytes.slice().buffer], { type: file.type }))
        pendingUrl = url
        try {
          const picture = new Image()
          const loaded = new Promise<void>((resolve, reject) => { picture.onload = () => resolve(); picture.onerror = () => reject(new Error('Could not read this image. Choose a PNG, JPEG, or WebP image.')) })
          picture.src = url
          await loaded
          if (picture.naturalWidth * picture.naturalHeight > WORKSPACE_IMAGE_PIXELS) throw new Error('Choose an image with at most 16 million pixels.')
          if (disposed) return
          setImage({ file, url, width: picture.naturalWidth, height: picture.naturalHeight })
          pendingUrl = undefined
        } finally { if (pendingUrl) { URL.revokeObjectURL(pendingUrl); pendingUrl = undefined } }
      })
    } finally { setBusy(false) }
  }
  const upload = async (crop: ImageCrop) => {
    const selected = image()
    const nodeId = activeNodeId()
    if (!selected || !nodeId || busy()) return
    setBusy(true)
    try {
      const saved = await save.run(async () => {
        await uploadWorkspaceImage(props.workspace.id, selected.file, crop, nodeId)
      })
      if (saved) { setDraft(undefined); setImage(undefined) }
    } finally { setBusy(false) }
  }
  const background = (kind: 'solid' | 'gradient') => {
    const value = icon()
    return commit({ ...value, background: kind === 'solid' ? { kind, color: 'blue' } : { kind, colors: ['blue', 'purple'], angle: 135 } })
  }
  const colors = () => { const value = icon().background; return value.kind === 'solid' ? [value.color] : value.colors }
  const changeColor = (index: number, color: string) => {
    const value = icon()
    const old = value.background
    return commit({ ...value, background: old.kind === 'solid' ? { ...old, color } : { ...old, colors: old.colors.map((entry, at) => at === index ? color : entry) } })
  }
  return (
    <SettingRow label="Icon" layout="stacked" error={save.error()} savedAt={save.savedAt()}>
      <div class="workspace-icon-editor">
        <div class="workspace-icon-previews">
          <WorkspaceIdentity name={props.workspace.name} appearance={appearance()} nodeId={activeNodeId()} size="rail" />
          <WorkspaceIdentity name={props.workspace.name} appearance={appearance()} nodeId={activeNodeId()} />
        </div>
        <Select label="Icon type" value={mode()} disabled={busy()} options={[{ value: 'icon', label: 'Icon and background' }, { value: 'image', label: 'Image' }]}
          onChange={(value) => { setMode(value); setImage(undefined); if (value === 'icon' && appearance()?.kind === 'image') void commit(defaultIcon()) }} />
        <Show when={mode() === 'icon'} fallback={
          <Show when={image()} keyed fallback={<Button disabled={busy()} onPress={() => void chooseImage()}>{props.workspace.appearance?.kind === 'image' ? 'Replace image…' : 'Choose image…'}</Button>}>
            {(selected) => <WorkspaceImageCrop draft={selected} name={props.workspace.name} busy={busy()} save={(crop) => void upload(crop)} cancel={() => setImage(undefined)} />}
          </Show>
        }>
          <div class="workspace-icon-controls">
            <IconPicker value={icon().icon} fallback="circle-dot" disabled={busy()} onSelect={(name) => void commit(name ? { ...icon(), icon: name } : null)} />
            <Select label="Background" value={icon().background.kind} disabled={busy()} options={[{ value: 'solid', label: 'Solid colour' }, { value: 'gradient', label: 'Gradient' }]} onChange={(value) => void background(value as 'solid' | 'gradient')} />
            <For each={colors()}>{(color, index) => <input type="color" aria-label={`Background colour ${index() + 1}`} value={resolveProjectColor(color)!} disabled={busy()} onChange={(event) => {
              const well = event.currentTarget
              void changeColor(index(), well.value).then((saved) => { if (!saved) well.value = resolveProjectColor(color)! })
            }} />}</For>
          </div>
        </Show>
        <div class="workspace-icon-controls">
          <Show when={props.workspace.appearance || draft() !== undefined}><Button variant="ghost" disabled={busy()} onPress={() => { setImage(undefined); void commit(null) }}>Reset icon</Button></Show>
          <Show when={save.error() && draft() !== undefined && !image()}><Button disabled={busy()} onPress={() => void commit(draft() ?? null)}>Retry save</Button></Show>
        </div>
      </div>
    </SettingRow>
  )
}
