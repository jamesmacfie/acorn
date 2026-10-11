/** @jsxImportSource @acorn/tui/jsx */
import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import type { DocumentSurfaceProps } from '@acorn/client-core/host/frames/documentSurface.ts'
import { MAX_DOCUMENT_BYTES } from '@acorn/protocol/plugin/bridge.ts'
import {
  documentCustody,
  recoverDocumentCustody,
  type DocumentCustody,
} from '@acorn/client-core/features/editor/documentCustody.ts'
import { documentUri, resolveDocumentRoute } from '@acorn/client-core/features/editor/documentModel.ts'
import { readJson, writeJson } from '@acorn/client-core/infra/node'
import { pluginLabel } from '@acorn/client-core/host/plugins'
import {
  LANGUAGE_REQUEST_TOO_LARGE,
  languageRequestTooLarge,
  positionAt,
  requestDiagnostics,
  requestHover,
  type CheckedDiagnostic,
  type CheckedHover,
} from '@acorn/client-core/host/registries/panes'
import { prefsOptions } from '@acorn/client-core/infra/queries.ts'
import { toKeymapKey } from '@acorn/client-core/kit/keys'
import { debounce } from '@acorn/client-core/kit/lib'
import { executeCommand, keybindingRegistry, resolveKeybindings } from '@acorn/client-core/host/registries/commands'
import type { PluginDocumentBody } from '@acorn/protocol/documentSurface.ts'
import type { Renderable } from '../tree/compat'
import { bindKeys } from '../keys/install'
import { asCtrl } from '../keys/commandLayer'
import { STOP } from '../keys/tiers'
import { Button, Textarea } from '../kit/asking'
import type { FieldApi } from '../kit/asking/fieldRef'
import { CodeBlock, Markdown, Row } from '../kit/showing'
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
  const address = [
    nodeId,
    props.scope.taskId ? 'task' : 'project',
    props.scope.taskId ?? props.scope.projectId ?? '',
    documentUri(props.pluginId, props.surfaceId),
    readPath,
    writePath,
  ]
  let custody: DocumentCustody | undefined
  let releaseCustody: (() => void) | undefined
  let unsubscribe: (() => void) | undefined
  let disposed = false
  const save = async (): Promise<void> => {
    if (!writePath || !custody) return
    try {
      await custody.flush(async (text) => {
        if (new TextEncoder().encode(text).byteLength > MAX_DOCUMENT_BYTES)
          throw new Error('Document exceeds 2 MiB. Its full text is retained for recovery.')
        const response = await writeJson<unknown>(writePath, {
          method: 'PUT',
          nodeId,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text } satisfies PluginDocumentBody),
        })
        if (response && typeof response === 'object' && 'ok' in response && response.ok === false)
          throw new Error('Save failed')
        return {}
      })
      if (!disposed) setError('')
    } catch (cause) {
      if (!disposed) setError(cause instanceof Error ? cause.message : 'Save failed')
      throw cause
    }
  }
  const scheduleSave = debounce(() => {
    void save().catch(() => {})
  }, 1500)
  const flush = async (): Promise<void> => {
    if (disposed) throw new Error('This document grant has retired.')
    scheduleSave.cancel()
    const revision = custody?.revision
    await save()
    if (disposed || custody?.dirty || custody?.revision !== revision)
      throw new Error('The document changed while saving. Try again.')
  }
  // Hover and diagnostics from this region's own routes, asked for by name: a terminal has no pointer
  // to hover with, so **Inspect position** asks about the caret. Same routes, coordinates, and checks
  // as the desktop (client-core features/editor/languageServices.ts).
  const label = pluginLabel(props.pluginId)
  const hoverPath = props.region.hover ? resolveDocumentRoute(props.region.hover.route, props.scope) : null
  const diagnosticsPath = props.region.diagnostics
    ? resolveDocumentRoute(props.region.diagnostics.route, props.scope)
    : null
  type Answer = { hover: CheckedHover } | { text: string; items: CheckedDiagnostic[] } | { note: string }
  const [answer, setAnswer] = createSignal<Answer>()
  let asking: AbortController | undefined
  const ask = async (kind: 'hover' | 'diagnostics'): Promise<void> => {
    const route = kind === 'hover' ? hoverPath : diagnosticsPath
    if (!route || !custody || disposed) return
    asking?.abort()
    const current = (asking = new AbortController())
    const text = custody.current.toString()
    const revision = custody.revision
    if (languageRequestTooLarge(text)) return void setAnswer({ note: LANGUAGE_REQUEST_TOO_LARGE })
    const offset = Math.min((field() as (Renderable & FieldApi) | undefined)?.cursor ?? 0, text.length)
    const result =
      kind === 'hover'
        ? await requestHover(route, nodeId, { text, revision, offset }, current.signal)
        : await requestDiagnostics(route, nodeId, { text, revision }, current.signal)
    // An edit while asking makes the answer about text that is gone.
    if (disposed || current.signal.aborted || custody.revision !== revision) return
    if (!result)
      return void setAnswer({ note: kind === 'hover' ? `Nothing from ${label} here.` : `${label} did not answer.` })
    setAnswer(Array.isArray(result) ? { text, items: result } : { hover: result })
  }
  onCleanup(() => asking?.abort())

  const change = (next: string): void => {
    // Keep the displayed field and the sibling frame's live handle in step even if a later save
    // rejects an oversized edit. Refusing only the signal here would leave the field showing SQL
    // that `bridge.document.read()` did not return.
    if (disposed) throw new Error('This document grant has retired.')
    custody?.editText(next)
    setValue(next)
    setAnswer(undefined)
    scheduleSave()
  }

  // Pane-scoped chords pressed inside the editor must flush before they reach the plugin frame.
  // The screen's command layer runs below this focused field. Resolve the same registered bindings
  // and user overrides it does, then claim only this pane's commands at the field's own tier.
  createEffect(() => {
    const target = field()
    if (!target) return
    const bindings = resolveKeybindings(keybindingRegistry.entries(), prefs.data ?? {})
      .filter(
        (binding) =>
          binding.when === 'pane' &&
          binding.pane === props.surfaceId &&
          binding.plugin?.id === props.pluginId &&
          binding.chord &&
          (!binding.active || binding.active()),
      )
      .flatMap((binding) => {
        const spelled = toKeymapKey(binding.chord!)
        if (!spelled) return []
        const key = asCtrl(spelled)
        return [
          {
            key,
            cmd: () => {
              void flush()
                .then(() => executeCommand(binding.command))
                .catch((cause: unknown) => {
                  setError(cause instanceof Error ? cause.message : 'Command failed')
                })
              return true
            },
          },
        ]
      })
    bindKeys(
      target,
      [
        ...(writePath
          ? [
              {
                key: 'ctrl+s',
                cmd: () => {
                  void flush().catch(() => {})
                  return true
                },
              },
            ]
          : []),
        ...bindings,
      ],
      STOP,
      { mode: 'focus' },
    )
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
        const body = recovery?.dirty
          ? { text: recovery.acknowledged.toString() }
          : await readJson<Partial<PluginDocumentBody>>(readPath, { nodeId })
        if (typeof body?.text !== 'string') return setError('This plugin returned an unreadable document.')
        if (!recovery && new TextEncoder().encode(body.text).byteLength > MAX_DOCUMENT_BYTES) {
          if (disposed) return
          return setError(
            'Document exceeds 2 MiB. Export the complete text from the authorized scratch GET route on this Node, or use Export full text in the desktop pane. See docs/database.md.',
          )
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
            if (new TextEncoder().encode(text).byteLength > MAX_DOCUMENT_BYTES)
              throw new Error('Document is too large.')
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
      <Show when={error()}>
        <Line tone="danger">{error()}</Line>
      </Show>
      <Show when={ready()} fallback={<Line role="muted">{error() ? '' : 'Loading document…'}</Line>}>
        <Show when={writePath} fallback={<CodeBlock>{value()}</CodeBlock>}>
          <Textarea
            value={value()}
            onInput={change}
            onBlur={() => {
              void flush().catch(() => {})
            }}
            ref={setField}
            grow
            boxed={false}
            mono
          />
        </Show>
        <Show when={(hoverPath && writePath) || diagnosticsPath}>
          <Row>
            <Show when={hoverPath && writePath}>
              <Button onPress={() => void ask('hover')}>Inspect position</Button>
            </Show>
            <Show when={diagnosticsPath}>
              <Button onPress={() => void ask('diagnostics')}>Diagnostics</Button>
            </Show>
          </Row>
        </Show>
        <Show when={answer()} keyed>
          {(value) => {
            if ('note' in value) return <Line role="muted">{value.note}</Line>
            if ('hover' in value) {
              return (
                <box flexDirection="column">
                  <Show when={value.hover.kind === 'markdown'} fallback={<Line wrap>{value.hover.value}</Line>}>
                    <Markdown text={value.hover.value} images="placeholder" />
                  </Show>
                  <Line role="muted">{`From ${label}`}</Line>
                </box>
              )
            }
            return (
              <box flexDirection="column">
                <Show when={value.items.length} fallback={<Line role="muted">{`No problems, from ${label}.`}</Line>}>
                  <Line role="muted">{`From ${label}:`}</Line>
                  <For each={value.items}>
                    {(item) => {
                      const at = positionAt(value.text, item.from)
                      return (
                        <Line
                          tone={item.severity === 'error' ? 'danger' : item.severity === 'warning' ? 'warn' : undefined}
                          wrap
                        >
                          {`${at.line}:${at.column} ${item.severity} ${item.message}${item.code ? ` (${item.code})` : ''}`}
                        </Line>
                      )
                    }}
                  </For>
                </Show>
              </box>
            )
          }}
        </Show>
      </Show>
    </box>
  )
}
