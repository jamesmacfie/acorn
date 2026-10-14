// A plugin's frame is a browser page in a sandboxed iframe, which only a DOM host can draw. The
// registration pass is shared by desktop and terminal, so a host that has no iframe supplies what
// stands in for one (docs/tui/plugin-losses.md).
import type { Component } from 'solid-js'
import type { PluginFrameProps } from './frameServices'

let supplied: Component<PluginFrameProps> | null = null

export function setFrameSurface(component: Component<PluginFrameProps>): void {
  supplied = component
}

export const suppliedFrameSurface = (): Component<PluginFrameProps> | null => supplied

export function _resetFrameSurface(): void {
  supplied = null
}
