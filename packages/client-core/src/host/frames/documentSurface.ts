// A document region belongs to the host, even when a plugin declares its routes. The registration
// pass is shared by desktop and terminal, so the host supplies the component that draws the editor.
import type { Component } from 'solid-js'
import type { DocumentSurfaceProps } from '../../features/editor/DocumentSurface'

export type { DocumentSurfaceProps } from '../../features/editor/DocumentSurface'
let supplied: Component<DocumentSurfaceProps> | null = null

export function setDocumentSurface(component: Component<DocumentSurfaceProps>): void {
  supplied = component
}

export const suppliedDocumentSurface = (): Component<DocumentSurfaceProps> | null => supplied

export function _resetDocumentSurface(): void {
  supplied = null
}
