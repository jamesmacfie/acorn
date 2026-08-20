import type { QueryClient } from '@tanstack/solid-query'
import { prefsKey } from '@acorn/protocol/api.ts'
import { sendRaw } from '../../apiClient'
import { toast } from '../../notifications/toast'
import { clientEvents, openPane } from '../../registries/clientEvents'
import { executeCommand } from '../../registries/commands'
import { openInAppUrl } from '../../registries/contentLinks'
import { keybindingRegistry, resolveFrameKeybinding, resolveKeybindings } from '../../registries/keybindings'
import { saveJsonPref } from '../../settings/savePref'
import { activeTaskId } from '../../tasks/tasks'
import type { FrameBinding, FrameServices } from './broker'
import { isSubscribable } from './channels'

// The fourteen host effects a plugin frame's bridge is allowed to cause (docs/plugins.md).
//
// The other side of the seam `broker.ts` opened. That module took `FrameServices` as a parameter
// specifically so the message-checking half could be tested in bare Node, at the cost of relocating
// every implementation into PluginFrame.tsx, where the repo's node-environment suites cannot follow it.
// So the seam moved the untestable surface rather than shrinking it, and the implementations are the
// half that reads prefs by hand, decides where a link goes, and pins which node a call reaches.
//
// They live here instead. PluginFrame.tsx keeps the component shell: the iframe, the port handshake, the
// lifecycle. This file is a plain function of the frame's props, so a test supplies a props literal and
// a fake query client and asserts on what each verb actually does.

export type PluginFrameProps = {
  // What the host resolved: which plugin, which surface, which bundle, and what it is looking at.
  binding: FrameBinding
  hash: string
  // Reference-panel surfaces only: which external item the panel was opened for.
  refId?: string
  // Project-scoped pane surfaces only: which item the URL addresses. A task-scoped pane gets the same
  // thing as a retained pane intent, because its selection lives in the task's layout state; a
  // project-scoped one has no such store, so the URL is the selection and it arrives as a prop the host
  // updates. Both feed the same two channels: whatever is set when the frame connects rides in
  // `context`, and every change after that is a `select` message rather than a remount.
  item?: string
  // Importer surfaces only. The host owns the modal chrome and the post-import refresh; the frame only
  // says when it is done.
  onImported?: () => void
  onClose?: () => void
  // A webview's visible pixels are host-owned. Its sandboxed client bundle remains mounted offscreen
  // solely as the typed controller that can issue the four allowed verbs.
  controllerOnly?: boolean
  // Composed panes only (`document-over-frame`): the sibling host editor's document, as an accessor
  // because the editor may not exist yet when this frame mounts. Read per bridge call rather than
  // captured, so a frame that connected first still reaches the document once it appears.
  document?: () => { read(): string; write(text: string): void; flush(): Promise<void> } | null
  webview?: {
    navigate(url: string): Promise<boolean>
    command(action: 'back' | 'forward' | 'reload'): Promise<boolean>
    subscribe(listener: (channel: 'webview:navigated' | 'webview:blocked', payload: unknown) => void): () => void
  }
}

export type FrameServiceHost = {
  qc: QueryClient
  // Whether input focus is currently inside this frame's document. Supplied by the component that owns
  // the iframe element, because only it holds the element to compare `document.activeElement` against.
  frameHasFocus(): boolean
  // The shell's navigator, for the route rung of a link clicked inside a frame. Supplied by the component
  // because `useNavigate` is only callable while one is being set up.
  navigate(to: string): void
}

/**
/**
 * Build one frame's services. Rebuilt per frame rather than shared: every closure below reads this
 * frame's binding, which is what pins its node and forbids the importer verbs on a pane.
 */
export function createFrameServices(props: PluginFrameProps, host: FrameServiceHost): FrameServices {
  const qc = host.qc
  return {
    fetch: async (method, path, body, signal) => {
      const result = await sendRaw(path, {
        method,
        // Pinned. The frame named a path and nothing else; which node it reaches is the host's to decide,
        // so there is no argument a plugin could pass to address a different one.
        nodeId: props.binding.nodeId,
        signal,
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      })
      return result
    },
    subscribe: (channel, listener) => {
      // Second half of the check the broker starts: it verifies the manifest declared the channel, this
      // verifies the shell has one. Subscribing never creates a channel.
      if (!isSubscribable(channel)) throw new Error(`${channel} is not a channel a plugin frame can subscribe to`)
      return clientEvents.on(channel, (payload) => listener(payload))
    },
    // Prefs are a flat string map on the wire, and `saveJsonPref` is what wrote this one, so reading it
    // back means parsing. A value that is not JSON is a value some other writer put there under this key,
    // which is not this plugin's state and is reported as absent rather than handed over as a string.
    stateGet: (key) => {
      const raw = qc.getQueryData<Record<string, string>>(prefsKey)?.[key]
      if (raw === undefined) return undefined
      try {
        return JSON.parse(raw) as unknown
      } catch {
        return undefined
      }
    },
    stateSet: async (key, value) => void (await saveJsonPref(qc, key, value)),
    // Into the shared transient stack, not the notification inbox. `bridge.ui.toast('Copied to the
    // clipboard')` used to leave a permanent bell entry; the frames and the shell now share one stack
    // and one look, which is what the API always claimed.
    toast: (title, detail) => toast(detail ? `${title} — ${detail}` : title),
    copy: (text) => void navigator.clipboard.writeText(text),
    openPane: (paneId) => {
      // A pane is opened in a task's layout, so a frame with no task has nothing to open into.
      const taskId = props.binding.taskId
      if (taskId) openPane(taskId, paneId)
    },
    // A link clicked inside a frame's rendered content, resolved on the host's side of the port through
    // the same content-link ladder and rung-preference rule every shell surface follows
    // (docs/plugins.md § Loaded plugins: the client half).
    openUrl: (url) => {
      // The bound task, never `activeTaskId()`, even though the shell's own content handlers use the
      // ambient one. A frame the host did not give a task is not looking at one: a project-scoped surface
      // and a ref panel both sit beside or over something that is not a task layout, while a task may well
      // still be selected in the rail behind them. Reading it here would let a link clicked on a project
      // page push a pane into a background task's persisted layout, where the reader is not and will not
      // see it. With no bound task the pane rung is simply unavailable, and the URL falls to the browser.
      // `openInAppUrl` rather than `openContentTarget`, so the plugin's own route is a destination here
      // too. It is the last one tried for a frame: the surfaces below either asked for the panel or said
      // nothing, which is what makes a github link clicked inside a Linear issue open github's panel
      // beside it rather than replacing the issue the reader is in the middle of.
      if (openInAppUrl(url, {
        taskId: props.binding.taskId,
        navigate: host.navigate,
        ...(props.binding.target === 'refPanel' ? { prefer: 'refPanel' as const } : {}),
      })) return
      // Nothing in-app claimed it. `window.open` is denied by main's setWindowOpenHandler, which hands
      // the URL to `shell.openExternal` behind the scheme allowlist, so this opens in the owner's
      // browser and never in-app, with no second policy to keep in step
      // (apps/desktop/src/app/main/electron.ts, docs/electron.md § navigation policy).
      window.open(url, '_blank', 'noopener,noreferrer')
    },
    frameHasFocus: () => host.frameHasFocus(),
    importerDone: () => props.onImported?.(),
    importerClose: () => props.onClose?.(),
    // Present only for a composed pane, and its absence is the permission check the broker applies:
    // there is no scope to declare, because the grant is structural. The indirection through the
    // accessor is what makes the two regions' mount order a non-issue: the frame can connect before the
    // editor has loaded its document, and its first `document.read()` still lands on the real thing.
    ...(props.document
      ? {
        document: {
          read: () => props.document?.()?.read() ?? '',
          write: (text: string) => props.document?.()?.write(text),
          flush: async () => void (await props.document?.()?.flush()),
        },
      }
      : {}),
    webviewNavigate: (url) => props.webview?.navigate(url) ?? Promise.resolve(false),
    webviewCommand: (action) => props.webview?.command(action) ?? Promise.resolve(false),
    keydown: (chord) => {
      const frameBinding = resolveFrameKeybinding(
        chord,
        resolveKeybindings(keybindingRegistry.entries(), qc.getQueryData<Record<string, string>>(prefsKey) ?? {}),
        {
          pluginId: props.binding.pluginId,
          surface: props.binding.surface,
          taskActive: !!props.binding.taskId && activeTaskId() === props.binding.taskId,
        },
      )
      if (!frameBinding) return
      void executeCommand(frameBinding.command).catch((error) => {
        console.error(`[command:${frameBinding.command}]`, error)
      })
    },
  }
}
