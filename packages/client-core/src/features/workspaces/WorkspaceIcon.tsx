import { createEffect, createMemo, createSignal, onCleanup, Show, type JSX } from 'solid-js'
import { resolveWorkspaceAppearance, type WorkspaceAppearance } from '@acorn/protocol/workspaceAppearance.ts'
import { resolveProjectColor } from '@acorn/protocol/projectColor.ts'
import Icon from '../../kit/components/content/Icon'
import { iconNode } from '../../kit/tokens/iconNodes'
import { acquireWorkspaceImage } from './workspaceImageResources'
import './workspace-icons.css'

export function workspaceInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return (words.length > 1 ? [...words[0]][0] + [...words.at(-1)!][0] : [...(words[0] ?? '?')].slice(0, 2).join('')).toLocaleUpperCase()
}

/** Presentational tile. The feature supplies an authenticated image resource, never a Node URL. */
export function WorkspaceIcon(props: { name: string; appearance?: WorkspaceAppearance | null; imageUrl?: string; imageStyle?: JSX.CSSProperties; size?: 'switcher' | 'rail' }) {
  const appearance = createMemo(() => resolveWorkspaceAppearance(props.appearance))
  const [failed, setFailed] = createSignal(false)
  createEffect(() => { props.imageUrl; setFailed(false) })
  const icon = () => { const value = appearance(); return value?.kind === 'icon' ? value : null }
  const background = () => {
    const value = icon()?.background
    if (!value) return undefined
    return value.kind === 'solid' ? resolveProjectColor(value.color)! : `linear-gradient(${value.angle}deg, ${value.colors.map(resolveProjectColor).join(', ')})`
  }
  return (
    <span class="workspace-icon" data-size={props.size ?? 'switcher'} style={{ background: background() }} aria-hidden="true">
      <Show when={appearance()?.kind === 'image' && props.imageUrl && !failed()} fallback={
        <Show when={icon() && iconNode(icon()!.icon)} fallback={<span>{workspaceInitials(props.name)}</span>}>
          <span class="workspace-icon-glyph"><Icon name={icon()!.icon} /></span>
        </Show>
      }>
        <img src={props.imageUrl} alt="" style={props.imageStyle} onError={() => setFailed(true)} />
      </Show>
    </span>
  )
}

/** Feature owner of image lifetimes; all navigation and preview surfaces use the same tile. */
export function WorkspaceIdentity(props: { name: string; nodeId?: string | null; appearance?: WorkspaceAppearance | null; size?: 'switcher' | 'rail' }) {
  const [url, setUrl] = createSignal<() => string | undefined>(() => undefined)
  const key = createMemo(() => {
    const appearance = resolveWorkspaceAppearance(props.appearance)
    return appearance?.kind === 'image' && props.nodeId ? JSON.stringify([props.nodeId, appearance.imageId]) : null
  })
  createEffect(() => {
    const value = key()
    setUrl(() => () => undefined)
    if (!value) return
    const [nodeId, imageId] = JSON.parse(value) as [string, string]
    const image = acquireWorkspaceImage(nodeId, imageId)
    setUrl(() => image.url)
    onCleanup(image.release)
  })
  return <WorkspaceIcon name={props.name} appearance={props.appearance} imageUrl={url()()} size={props.size} />
}
