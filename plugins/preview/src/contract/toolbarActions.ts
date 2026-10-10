// What another plugin may add to Preview's address bar (docs/plugins/toolbar-actions.md).
//
// Facts about the page and one action. A contributor never gets the page itself, its contents, or a
// way to navigate: browsing stays the person's, through Preview's own controls.

export const PREVIEW_TOOLBAR_ACTIONS_POINT = 'preview:toolbar-actions'

/** How many contributors draw before the host shows a count of the rest. */
export const PREVIEW_TOOLBAR_ACTIONS_MAX = 4

/** What a contributor is mounted with. `url` is the page the native view last reported, and is absent
 *  while there is no page to act on, so a contributor shouldn't offer Reload then. */
export type PreviewToolbarProps = {
  taskId: string
  projectId?: string
  url?: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

/** `host.invoke('reload', payload)`. Refused unless `expectedUrl` is still the page on screen. */
export type PreviewReloadPayload = { expectedUrl: string }

/**
 * What `reload` answers. A refusal, not an error, so the contributor can say why in its own control.
 *
 * - `needs_person`: nobody pressed anything in the contributor's tree just now.
 * - `changed`: the page, the task, or the Node changed since the contributor drew.
 * - `unsupported`: Preview has no live page here to reload.
 */
export type PreviewToolbarResult = { ok: true } | { ok: false; reason: 'needs_person' | 'changed' | 'unsupported' }
