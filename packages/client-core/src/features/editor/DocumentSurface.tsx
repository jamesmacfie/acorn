import { measure, recordSample } from '../../infra/telemetry/emitter'
import { createSignal, onMount, onCleanup, Show } from 'solid-js'
import { useQueryClient } from '@tanstack/solid-query'
import { basicSetup } from 'codemirror'
import { EditorState, Prec, StateEffect, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { prefsKey } from '@acorn/protocol/api.ts'
import type { PluginDocumentRegion } from '@acorn/protocol/api.ts'
import { eventChord } from '@acorn/protocol/keybindings.ts'
import { isLanguageId } from '@acorn/protocol/languageIds.ts'
import { readJson, writeJson } from '../../infra/node/apiClient'
import { debounce } from '../../kit/lib/state/debounce'
import { executeCommand } from '../../host/registries/commands/commands'
import { keybindingRegistry, resolveFrameKeybinding, resolveKeybindings } from '../../host/registries/commands/keybindings'
import {
  documentUri,
  documentViewState,
  MAX_COMPLETION_ITEMS,
  MAX_DOCUMENT_BYTES,
  rememberDocumentViewState,
  resolveDocumentRoute,
  type DocumentHandle,
  type DocumentScope,
  type PluginCompletionItem,
  type PluginCompletionRequest,
  type PluginDocumentBody,
} from './documentModel'
import { documentCustody, recoverDocumentCustody, type DocumentCustody } from './documentCustody'
import { languageFor, shouldHighlightDocument } from './language'
import { editorTheme, watchEditorTheme } from './theme'
import { applyViewState, captureViewState, type EditorViewState } from './viewState'
import { saveFile } from '../../infra/platform'
import { Button } from '../../kit/components/inputs/Button'
import { Alert } from '../../kit/components/primitives'
import { Rectangle } from '../../kit/components/content/Rectangle'
import { createLogger } from '../../infra/telemetry/logger'

const log = createLogger('document-surface')

// A host-owned document surface: the host draws the editor, the plugin supplies the document. See
// docs/editor.md.
//
// This is the whole point of the design, so it is worth being blunt about what is where. The plugin
// declared a language id and two routes and that is all it declared. Everything else on this screen, the
// editor instance, the theme, the dirty document, the autosave debounce, cmd+S, the
// flush-before-unmount, the view state and its eviction, is the host's, which is why a plugin cannot get
// any of it wrong. It also never sees a byte of the editor: a frame that bundled its own would be
// megabytes and would run without language services, because a plugin origin serves one file.
//
// Three of the things this file's first release deliberately left out have since arrived with their
// consumer, the database pane, and they are the parts worth knowing about:
//
//   - `onHandle` hands the composed pane's frame region a read, write and flush view of this document.
//     The splitter itself is the layout's, not this component's; this one still just fills whatever
//     rectangle it was given.
//   - Surface actions. A chord like cmd+Enter is pressed with focus inside this editor, where the
//     plugin's iframe has no keyboard at all, so the host resolves it and posts the command across. The
//     document is flushed first, and that ordering is a contract rather than an implementation detail:
//     without it every plugin independently rediscovers "it ran the previous version of my query".
//   - Completions, as a plain POST to a route the plugin declared. The host stays a dumb proxy: it never
//     learns the language, which is what lets the same mechanism serve SQL, GraphQL and YAML.
//
// The editor is imported here at module scope and not in the frame registry, which is the file that
// registers this pane: that one is evaluated on every shell boot, so it reaches this module through
// `lazy()` instead. The grammars arrive when a document pane first opens, which is the only moment they
// are needed, and a shell that never opens one never loads them.

export type DocumentSurfaceProps = {
  pluginId: string
  surfaceId: string
  // Pinned by the host. A frame cannot name a node and neither can a document.
  nodeId: string
  region: PluginDocumentRegion
  scope: DocumentScope
  // `document-over-frame` only: the sibling frame's view of this document, handed up as soon as the editor
  // exists and withdrawn when it goes. A callback rather than a ref because the frame region may well
  // mount first. There is no ordering to rely on, so the handle is pushed when it becomes true.
  onHandle?: (handle: DocumentHandle | null) => void
}

// LSP's kind names onto the ones CodeMirror draws an icon for. Total over the vocabulary, so adding a
// kind fails `tsc` here until someone says what this engine draws for it, the same rule language.ts
// follows.
const COMPLETION_KIND: Record<NonNullable<PluginCompletionItem['kind']>, string> = {
  text: 'text',
  keyword: 'keyword',
  field: 'property',
  class: 'class',
  function: 'function',
  value: 'variable',
}

// One document per scope under the degenerate template, so the scope id is all the view-state key needs
// beyond the uri. A task-scoped pane keys on its task; a project-scoped one on its project.
const scopeId = (scope: DocumentScope): string => scope.taskId ?? scope.projectId ?? ''

export default function DocumentSurface(props: DocumentSurfaceProps) {
  const qc = useQueryClient()
  const [error, setError] = createSignal('')
  const [ready, setReady] = createSignal(false)
  const [oversizedText, setOversizedText] = createSignal<string>()

  // Read once at mount and held: a pane is rebuilt on a node switch (the shell keys on the node) and a
  // document surface serves one document per scope, so there is nothing here that can go stale underneath
  // the instance.
  const uri = documentUri(props.pluginId, props.surfaceId)
  const scope = scopeId(props.scope)
  const nodeId = props.nodeId
  const readPath = resolveDocumentRoute(props.region.read, props.scope)
  const writePath = props.region.write ? resolveDocumentRoute(props.region.write, props.scope) : null
  const address = [nodeId, props.scope.taskId ? 'task' : 'project', scope, uri, readPath, writePath]
  // A language id the manifest parser already checked, re-checked because the manifest reached this
  // device as a roster row, which is bytes a node sent (the rule chrome/data.ts states).
  //
  // Started here and awaited beside the document's text below, because the grammar is a download of
  // its own (./language.ts fetches one per language). Kicked off at mount so it is in flight while the
  // read route answers, and the two land together.
  // `.catch` rather than a rejection the load block has to handle: a grammar that will not download
  // means no highlighting, and no highlighting beats no document.
  const language = measure(props.pluginId, 'editor.language.load', () => languageFor(isLanguageId(props.region.languageId) ? props.region.languageId : 'plaintext'))
    .catch(() => [] as Extension)

  let host: HTMLElement | undefined
  let view: EditorView | undefined
  let stopTheme: (() => void) | undefined
  let disposed = false
  // Custody outlives this surface; the surface supplies a captured writer while its grant is live.
  let custody: DocumentCustody | undefined
  let releaseCustody: (() => void) | undefined
  let unsubscribe: (() => void) | undefined

  const scheduleSave = debounce(() => void save().catch(() => {}), 1500)

  const saveViewState = (): void => {
    if (view) {
      const state = captureViewState(view)
      rememberDocumentViewState(nodeId, scope, uri, state)
      if (custody) { custody.viewState = state; custody.state = view.state; custody.flushRecovery() }
    }
  }

  // No `disposed` guard on the way in. The last thing an unmounting pane does is flush, and everything up
  // to the `await`, including reading the text out of the view, runs synchronously, so the value is
  // captured before the view is destroyed below. Only the state writes afterwards are guarded, because by
  // then the component may be gone.
  async function save(): Promise<void> {
    if (!custody || !writePath) return
    try {
      await custody.flush(async (text) => {
        if (new TextEncoder().encode(text).byteLength > MAX_DOCUMENT_BYTES) throw new Error('Document is larger than 2 MiB. Its full text is retained for recovery.')
        const result = await writeJson<unknown>(writePath, {
          method: 'PUT', nodeId, headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text } satisfies PluginDocumentBody),
        })
        if (result && typeof result === 'object' && 'ok' in result && result.ok === false) throw new Error('Save failed')
        return {}
      })
      if (!disposed) setError('')
    } catch (cause) {
      if (!disposed) setError(cause instanceof Error ? cause.message : 'Save failed')
      throw cause
    }
  }

  /** The flush every surface action waits on, and the one the frame can ask for by name. */
  const flush = async (): Promise<void> => {
    if (disposed) throw new Error('This document grant has retired. Reopen the surface to retry.')
    scheduleSave.cancel()
    const revision = custody?.revision
    await save()
    if (disposed || custody?.dirty || custody?.revision !== revision) throw new Error('The document changed while saving. Try again.')
  }

  // A chord pressed with focus inside this editor. It cannot reach the shell's window dispatcher, since
  // that one refuses scoped bindings while a typing target has focus and the editor's content area is
  // one, and it cannot reach the plugin's frame either, which is in a different document. So the host
  // resolves it here, against the same registry and the same policy PluginFrame uses for chords a frame
  // forwards.
  //
  // Only pane-scoped bindings are taken. Global and task chords have already had their chance on `window`
  // in the capture phase before the editor saw the event, and taking them a second time here would fire
  // them twice.
  const onEditorKeyDown = (event: KeyboardEvent): boolean => {
    const chord = eventChord(event)
    if (!chord) return false
    const prefs = qc.getQueryData<Record<string, string>>(prefsKey) ?? {}
    const binding = resolveFrameKeybinding(chord, resolveKeybindings(keybindingRegistry.entries(), prefs), {
      pluginId: props.pluginId,
      surface: props.surfaceId,
      // This editor is only ever drawn inside its pane, so its pane being on screen is the fact the scope
      // test is asking about.
      taskActive: true,
    })
    if (binding?.when !== 'pane') return false
    event.preventDefault()
    event.stopPropagation()
    // Flush first, then run. This is the contract guarantee: a surface action never fires against a stale
    // document.
    void flush()
      .then(() => executeCommand(binding.command))
      .catch((cause: unknown) => log.error(`command ${binding.command} failed`, cause, { 'command.id': binding.command }))
    return true
  }

  // The plugin's items, offered for this view only. CodeMirror's completion sources hang off the state
  // rather than off a global per-language registry, so unlike Monaco there is nothing here that a second
  // document pane in the same language could be offered by mistake.
  type CompletionSource = (context: CompletionContext) => Promise<CompletionResult | null>
  const completions = (): CompletionSource | null => {
    const declared = props.region.completions
    if (!declared) return null
    const path = resolveDocumentRoute(declared.route, props.scope)
    if (!path) return null
    const triggers = new Set(declared.triggerCharacters ?? [])
    return async (context: CompletionContext): Promise<CompletionResult | null> => {
      // The word under the cursor, so the accepted item replaces it rather than being inserted beside it.
      const word = context.matchBefore(/[\w$.]*/)
      const before = context.state.sliceDoc(Math.max(0, context.pos - 1), context.pos)
      if (!context.explicit && !triggers.has(before) && (!word || word.from === word.to)) return null
      const line = context.state.doc.lineAt(context.pos)
      let items: PluginCompletionItem[]
      try {
        const body = await writeJson<{ items?: PluginCompletionItem[] }>(path, {
          method: 'POST',
          nodeId,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            text: context.state.doc.toString(),
            position: { line: line.number, column: context.pos - line.from + 1 },
          } satisfies PluginCompletionRequest),
        })
        items = Array.isArray(body?.items) ? body.items : []
      } catch {
        // A failed completion is not an error the reader needs told about; the popup simply has nothing
        // in it. The document itself is unaffected, unlike a failed save.
        return null
      }
      if (disposed || context.aborted) return null
      const options = items.slice(0, MAX_COMPLETION_ITEMS).flatMap<Completion>((item) => {
        // Route output is bytes a node sent, so the shape is checked rather than believed.
        if (typeof item?.label !== 'string' || !item.label) return []
        return [{
          label: item.label,
          type: COMPLETION_KIND[item.kind ?? 'text'] ?? COMPLETION_KIND.text,
          ...(typeof item.insertText === 'string' ? { apply: item.insertText } : {}),
          ...(typeof item.detail === 'string' ? { detail: item.detail } : {}),
        }]
      })
      return { from: word?.from ?? context.pos, options }
    }
  }

  onMount(() => {
    onCleanup(() => {
      props.onHandle?.(null)
      saveViewState() // pane unmounting (task or workspace switch) — remember where we were
      scheduleSave.cancel()
      void save().catch(() => {}) // captured routes own the final admitted write
      disposed = true
      unsubscribe?.()
      releaseCustody?.()
      stopTheme?.()
      view?.destroy()
    })

    void (async () => {
      if (!readPath) return setError('This surface needs a task; open one first.')
      let text: string
      const recovery = recoverDocumentCustody(address)
      try {
        const body = recovery?.dirty ? await Promise.resolve({ text: recovery.acknowledged.toString() }) : await readJson<Partial<PluginDocumentBody>>(readPath, { nodeId })
        if (typeof body?.text !== 'string') {
          log.warn(`${props.pluginId} returned an unusable document`, body, { 'plugin.id': props.pluginId })
          return setError('This plugin returned an unreadable document.')
        }
        // Refused whole rather than trimmed: a truncated document in an editor that will save it back is
        // data loss wearing the shape of a rendering limit.
        if (!recovery && new TextEncoder().encode(body.text).byteLength > MAX_DOCUMENT_BYTES) {
          if (disposed) return
          setOversizedText(body.text)
          return setError('Document exceeds 2 MiB. Export its full text before replacing it through the authorized storage route, then reopen this pane.')
        }
        recordSample(props.pluginId, 'editor.document.characters', body.text.length)
        text = body.text
      } catch (cause) {
        return setError(cause instanceof Error ? cause.message : 'Could not load this document.')
      }
      if (disposed) return
      setReady(true) // renders the host div synchronously
      if (!host) return

      const highlighted = shouldHighlightDocument(recovery?.current.length ?? text.length)
      if (!highlighted) recordSample(props.pluginId, 'editor.syntax.skipped', text.length, 'character', { reason: 'document-size' })
      const grammar: Extension = []
      custody = recovery ?? documentCustody(address, text)
      releaseCustody = custody.retain()
      if (custody.error) setError(custody.error)
      const autocomplete = completions()
      const extensions: Extension[] = [
          basicSetup,
          editorTheme(),
          grammar,
          // Highest precedence, so a surface action wins over whatever the editor would have done with
          // the same chord.
          Prec.highest(EditorView.domEventHandlers({ keydown: onEditorKeyDown })),
          // A read route with no write route is a real mode, not a degenerate one.
          ...(writePath ? [] : [EditorState.readOnly.of(true), EditorView.editable.of(false)]),
          ...(autocomplete ? [EditorState.languageData.of(() => [{ autocomplete }])] : []),
          ...(writePath
            ? [
              // Autosave, with cmd+S as an explicit flush rather than the only way to persist, the same
              // semantics the editor pane has, now owned once instead of per plugin.
              EditorView.updateListener.of((update) => {
                if (update.docChanged && !disposed && custody) {
                  custody.state = update.state
                  custody.edit(update.state.doc)
                  if (custody.dirty || custody.writing) scheduleSave()
                  else scheduleSave.cancel()
                }
              }),
              EditorView.domEventHandlers({ blur: () => { scheduleSave.flush(); return false } }),
              Prec.highest(keymap.of([{ key: 'Mod-s', run: () => { void flush().catch(() => {}); return true } }])),
            ]
            : []),
      ]
      const state = measure(props.pluginId, 'editor.state.create', () => EditorState.create({ doc: custody!.current, extensions }))
      const restored = custody.state ? custody.state.update({ effects: StateEffect.reconfigure.of(extensions) }).state : state
      view = measure(props.pluginId, 'editor.view.create', () => new EditorView({ state: restored, parent: host }))
      custody.state = view.state
      unsubscribe = custody.subscribe(() => {
        if (disposed || !view || !custody) return
        if (custody.error) setError(custody.error)
        if (!view.state.doc.eq(custody.current)) view.setState(custody.state ?? view.state)
      })
      if (highlighted) void language.then((loaded) => {
        if (disposed || !view || !custody || (Array.isArray(loaded) && !loaded.length)) return
        view.dispatch({ effects: StateEffect.appendConfig.of(loaded) })
        custody.state = view.state
      })
      stopTheme = watchEditorTheme(view)
      const remembered = custody.viewState ?? documentViewState(nodeId, scope, uri) as EditorViewState | undefined
      if (remembered) applyViewState(view, remembered)
      // The frame's view of this document. `write` goes through a transaction, so it lands in the undo
      // stack and schedules the same autosave a keystroke would. Loading a saved query is an edit like
      // any other, and cmd+Z after one is what a reader expects. A read-only surface still gets a handle;
      // `write` is the one that has nowhere to go, and it is a no-op rather than a throw, because the
      // plugin declared no write route and already knows.
      props.onHandle?.({
        read: () => {
          if (disposed) throw new Error('This document grant has retired.')
          return custody?.current.toString() ?? ''
        },
        write: writePath
          ? (next) => {
            if (disposed) throw new Error('This document grant has retired.')
            if (new TextEncoder().encode(next).byteLength > MAX_DOCUMENT_BYTES) throw new Error('Document is too large.')
            view?.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } })
          }
          : () => {},
        flush,
      })
    })()
  })

  return (
    // Not `.pane`: this section's only mount point is a host layout region, which is already inside a `.pane`,
    // so carrying the class too drew a second border, radius, shadow and background inside the first, and
    // a second `contain: layout paint` nobody needed. A region of a pane is not a pane.
    <section class="document-surface">
      <Show when={error()}><Alert>{error()}</Alert></Show>
      <Show when={ready() || oversizedText() !== undefined}>
        <Button onPress={() => {
          const text = custody?.current.toString() ?? oversizedText()
          if (disposed || text === undefined) return
          void saveFile({ bytes: new TextEncoder().encode(text), suggestedName: `${props.surfaceId}.txt`, mimeType: 'text/plain;charset=utf-8' }).catch((cause: unknown) => {
            if (!disposed) setError(cause instanceof Error ? cause.message : 'Export failed')
          })
        }}>Export full text</Button>
      </Show>
      {/* The editor owns these pixels, so the box is a rectangle: the kit owns it and the way in and out
          of it with the keyboard, which is what stops a reader who tabs into an editor region from
          being stuck there (ui/Rectangle.tsx). */}
      <Show when={ready()}>
        <Rectangle kind="editor" label={`${props.surfaceId} document`} mount={(element) => { host = element }} />
      </Show>
    </section>
  )
}
