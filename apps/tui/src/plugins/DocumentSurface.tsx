/** @jsxImportSource @acorn/tui/jsx */
import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import type { DocumentSurfaceProps } from '@acorn/client-core/host/frames/documentSurface.ts'
import { MAX_DOCUMENT_BYTES } from '@acorn/protocol/plugin/bridge.ts'
import { documentCustody, recoverDocumentCustody, type DocumentCustody } from '@acorn/client-core/features/editor/documentCustody.ts'
import { documentUri, resolveDocumentRoute } from '@acorn/client-core/features/editor/documentModel.ts'
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
  const nodeId = props.nodeId
  const address = [nodeId, props.scope.taskId ? 'task' : 'project', props.scope.taskId ?? props.scope.projectId ?? '', documentUri(props.pluginId, props.surfaceId), readPath, writePath]
  let custody: DocumentCustody | undefined
  let releaseCustody: (() => void) | undefined
  let unsubscribe: (() => void) | undefined
  let disposed = false
  const save = async (): Promise<void> => {
    if (!writePath || !custody) return
    try {
      await custody.flush(async (text) => {
        if (new TextEncoder().encode(text).byteLength > MAX_DOCUMENT_BYTES) throw new Error('Document exceeds 2 MiB. Its full text is retained for recovery.')
        const response = await writeJson<unknown>(writePath, {
          method: 'PUT', nodeId, headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text } satisfies PluginDocumentBody),
        })
        if (response && typeof response === 'object' && 'ok' in response && response.ok === false) throw new Error('Save failed')
        return {}
      })
      if (!disposed) setError('')
    } catch (cause) {
      if (!disposed) setError(cause instanceof Error ? cause.message : 'Save failed')
      throw cause
    }
  }
  const scheduleSave = debounce(() => { void save().catch(() => {}) }, 1500)
  const flush = async (): Promise<void> => {
    if (disposed) throw new Error('This document grant has retired.')
    scheduleSave.cancel()
    const revision = custody?.revision
    await save()
    if (disposed || custody?.dirty || custody?.revision !== revision) throw new Error('The document changed while saving. Try again.')
  }
  const change = (next: string): void => {
    // Keep the displayed field and the sibling frame's live handle in step even if a later save
    // rejects an oversized edit. Refusing only the signal here would leave the field showing SQL
    // that `bridge.document.read()` did not return.
    if (disposed) throw new Error('This document grant has retired.')
    custody?.editText(next)
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
      unsubscribe?.()
      releaseCustody?.()
    })
    void (async () => {
      if (!readPath) return setError('This surface needs a task; open one first.')
      try {
        const recovery = recoverDocumentCustody(address)
        const body = recovery?.dirty ? { text: recovery.acknowledged.toString() } : await readJson<Partial<PluginDocumentBody>>(readPath, { nodeId })
        if (typeof body?.text !== 'string') return setError('This plugin returned an unreadable document.')
        if (!recovery && new TextEncoder().encode(body.text).byteLength > MAX_DOCUMENT_BYTES) {
          if (disposed) return
          return setError('Document exceeds 2 MiB. Export the complete text from the authorized scratch GET route on this Node, or use Export full text in the desktop pane. See docs/database.md.')
        }
        if (disposed) return
        custody = recovery ?? documentCustody(address, body.text)
        releaseCustody = custody.retain()
        setValue(custody.current.toString())
        if (custody.error) setError(custody.error)
        unsubscribe = custody.subscribe(() => {
          if (disposed || !custody) return
          setValue(custody.current.toString())
          if (custody.error) setError(custody.error)
        })
        setReady(true)
        props.onHandle?.({
          read: () => {
            if (disposed) throw new Error('This document grant has retired.')
            return custody!.current.toString()
          },
          write: (text) => {
            if (disposed) throw new Error('This document grant has retired.')
            if (new TextEncoder().encode(text).byteLength > MAX_DOCUMENT_BYTES) throw new Error('Document is too large.')
            if (writePath) change(text)
          },
          flush,
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
