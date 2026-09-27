/** @jsxImportSource @acorn/tui/jsx */
import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import type { DocumentSurfaceProps } from '@acorn/client-core/host/frames/documentSurface.ts'
import { MAX_DOCUMENT_BYTES } from '@acorn/protocol/plugin/bridge.ts'
import { resolveDocumentRoute } from '@acorn/client-core/features/editor/documentModel.ts'
import { readJson, writeJson } from '@acorn/client-core/infra/node'
import { prefsOptions } from '@acorn/client-core/infra/queries.ts'
import { toKeymapKey } from '@acorn/client-core/kit/keys'
import { debounce } from '@acorn/client-core/kit/lib'
import { executeCommand, keybindingRegistry, resolveKeybindings } from '@acorn/client-core/host/registries/commands'
import type { PluginDocumentBody } from '@acorn/protocol/documentSurface.ts'
import type { Renderable } from '../tree/compat'
import { bindKeys } from '../keys/install'
import { asCtrl } from '../keys/commandLayer'
import { STOP } from '../keys/tiers'
import { Textarea } from '../kit/asking'
import { CodeBlock } from '../kit/showing'
import { Line } from '../kit/cells'

// The host-owned document region in cells. The manifest supplies only confined routes; this host
// owns the edit buffer, saving and the handle a sibling plugin tree reads. No DOM editor can cross
// this boundary, and no document bytes need to pass through the plugin's worker to draw here.
export function DocumentSurface(props: DocumentSurfaceProps) {
  const prefs = createQuery(() => prefsOptions(true))
  const [field, setField] = createSignal<Renderable>()
  const [value, setValue] = createSignal('')
  const [ready, setReady] = createSignal(false)
  const [error, setError] = createSignal('')
  const readPath = resolveDocumentRoute(props.region.read, props.scope)
  const writePath = props.region.write ? resolveDocumentRoute(props.region.write, props.scope) : null
  let saved = ''
  let disposed = false
  let pending: Promise<void> = Promise.resolve()

  const save = (): Promise<void> => {
    if (!writePath || !ready()) return pending
    const text = value()
    // A write that has already started must finish before the next one. Otherwise a slow earlier
    // response could leave the node holding older SQL after a later flush returned.
    pending = pending.catch(() => {}).then(async () => {
      if (text === saved) return
      await writeJson<unknown>(writePath, {
        method: 'PUT',
        nodeId: props.nodeId,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text } satisfies PluginDocumentBody),
      })
      saved = text
      if (!disposed) setError('')
    }).catch((cause: unknown) => {
      if (!disposed) setError(cause instanceof Error ? cause.message : 'Save failed')
      throw cause
    })
    return pending
  }
  const scheduleSave = debounce(() => { void save().catch(() => {}) }, 1500)
  const flush = (): Promise<void> => {
    scheduleSave.cancel()
    return save()
  }
  const change = (next: string): void => {
    // Keep the displayed field and the sibling frame's live handle in step even if a later save
    // rejects an oversized edit. Refusing only the signal here would leave the field showing SQL
    // that `bridge.document.read()` did not return.
    setValue(next)
    scheduleSave()
  }

  // Pane-scoped chords pressed inside the editor must flush before they reach the plugin frame.
  // The screen's command layer runs below this focused field. Resolve the same registered bindings
  // and user overrides it does, then claim only this pane's commands at the field's own tier.
  createEffect(() => {
    const target = field()
    if (!target) return
    const bindings = resolveKeybindings(keybindingRegistry.entries(), prefs.data ?? {})
      .filter((binding) => binding.when === 'pane' && binding.pane === props.surfaceId
        && binding.plugin?.id === props.pluginId && binding.chord && (!binding.active || binding.active()))
      .flatMap((binding) => {
        const spelled = toKeymapKey(binding.chord!)
        if (!spelled) return []
        const key = asCtrl(spelled)
        return [{ key, cmd: () => {
          void flush().then(() => executeCommand(binding.command)).catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : 'Command failed')
          })
          return true
        } }]
      })
    bindKeys(target, [
      ...(writePath ? [{ key: 'ctrl+s', cmd: () => { void flush().catch(() => {}); return true } }] : []),
      ...bindings,
    ], STOP, { mode: 'focus' })
  })

  onMount(() => {
    onCleanup(() => {
      props.onHandle?.(null)
      scheduleSave.cancel()
      void save().catch(() => {})
      disposed = true
    })
    void (async () => {
      if (!readPath) return setError('This surface needs a task; open one first.')
      try {
        const body = await readJson<Partial<PluginDocumentBody>>(readPath, { nodeId: props.nodeId })
        if (typeof body?.text !== 'string') return setError('This plugin returned an unreadable document.')
        if (new TextEncoder().encode(body.text).byteLength > MAX_DOCUMENT_BYTES) {
          return setError(`Document is larger than ${MAX_DOCUMENT_BYTES / 1024 / 1024} MiB.`)
        }
        if (disposed) return
        saved = body.text
        setValue(body.text)
        setReady(true)
        props.onHandle?.({
          read: value,
          write: writePath ? change : () => {},
          flush: writePath ? flush : async () => {},
        })
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : 'Could not load this document.')
      }
    })()
  })

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <Show when={error()}><Line tone="danger">{error()}</Line></Show>
      <Show when={ready()} fallback={<Line role="muted">{error() ? '' : 'Loading document…'}</Line>}>
        <Show when={writePath} fallback={<CodeBlock>{value()}</CodeBlock>}>
          <Textarea value={value()} onInput={change} onBlur={() => { void flush().catch(() => {}) }} ref={setField} grow boxed={false} mono />
        </Show>
      </Show>
    </box>
  )
}
