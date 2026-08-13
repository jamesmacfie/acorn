import { createSignal, onMount, onCleanup, Show } from 'solid-js'
import { useQueryClient } from '@tanstack/solid-query'
import * as monaco from 'monaco-editor'
import { prefsKey } from '@acorn/protocol/api.ts'
import type { PluginDocumentRegion } from '@acorn/protocol/api.ts'
import { eventChord } from '@acorn/protocol/keybindings.ts'
import { isLanguageId } from '@acorn/protocol/languageIds.ts'
import { readJson, writeJson } from '../apiClient'
import { debounce } from '../lib/debounce'
import { executeCommand } from '../registries/commands'
import { keybindingRegistry, resolveFrameKeybinding, resolveKeybindings } from '../registries/keybindings'
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
import { monacoLanguageFor } from './language'
import { MONACO_THEME, watchMonacoTheme } from './theme'
import { Alert } from '../ui/primitives'

// A host-owned document surface: the host draws the editor, the plugin supplies the document
// (docs/future/monaco.md).
//
// This is the whole point of the design, so it is worth being blunt about what is where. The plugin
// declared a language id and two routes and that is ALL it declared. Everything else on this screen —
// the Monaco instance, the theme, the workers, the dirty model, the autosave debounce, ⌘S, the
// flush-before-unmount, the view state and its eviction — is the host's, which is why a plugin cannot
// get any of it wrong. It also never sees a byte of Monaco: a frame that bundled its own would be
// 7.9 MiB and would run without language services, because a plugin origin serves one file and the
// frame CSP has no `worker-src`.
//
// Three of the things this file's first release deliberately left out have since arrived with their
// consumer, the database pane, and they are the parts worth knowing about:
//
//   - `onHandle` hands the composed pane's frame region a read/write/flush view of this document. The
//     splitter itself is DocumentOverFrame's, not this component's — this one still just fills whatever
//     rectangle it was given.
//   - SURFACE ACTIONS. A chord like ⌘Enter is pressed with focus inside this editor, where the plugin's
//     iframe has no keyboard at all, so the host resolves it and posts the command across. The document
//     is flushed FIRST, and that ordering is a contract rather than an implementation detail: without
//     it every plugin independently rediscovers "it ran the previous version of my query".
//   - COMPLETIONS, as a plain POST to a route the plugin declared. The host stays a dumb proxy — it
//     never learns the language, which is what lets the same mechanism serve SQL, GraphQL and YAML.
//
// There is also no abstraction layer, on purpose. One implementation behind an internal interface is
// over-building; the NAME the plugin declares is neutral, the code below calls Monaco bluntly, and
// when shiki backs a read-only variant that is a branch in this file rather than a strategy pattern.
//
// Monaco is imported here at module scope and NOT in the frame registry, which is the file that
// registers this pane: that one is evaluated on every shell boot, so it reaches this module through
// `lazy()` instead. Monaco arrives when a document pane first opens, which is the only moment it is
// needed, and a shell that never opens one never loads it.

export type DocumentSurfaceProps = {
  pluginId: string
  surfaceId: string
  // Pinned by the host. A frame cannot name a node and neither can a document.
  nodeId: string
  region: PluginDocumentRegion
  scope: DocumentScope
  // `document-over-frame` only: the sibling frame's view of this document, handed up as soon as the
  // editor exists and withdrawn when it goes. A callback rather than a ref because the frame region may
  // well mount first — there is no ordering to rely on, so the handle is pushed when it becomes true.
  onHandle?: (handle: DocumentHandle | null) => void
}

// LSP's kind names onto Monaco's enum. Total over the vocabulary, so adding a kind fails `tsc` here
// until someone says what this engine draws for it — the same rule language.ts follows.
const COMPLETION_KIND: Record<NonNullable<PluginCompletionItem['kind']>, monaco.languages.CompletionItemKind> = {
  text: monaco.languages.CompletionItemKind.Text,
  keyword: monaco.languages.CompletionItemKind.Keyword,
  field: monaco.languages.CompletionItemKind.Field,
  class: monaco.languages.CompletionItemKind.Class,
  function: monaco.languages.CompletionItemKind.Function,
  value: monaco.languages.CompletionItemKind.Value,
}

// One document per scope under the degenerate template, so the scope id is all the view-state key
// needs beyond the uri. A task-scoped pane keys on its task; a project-scoped one on its project.
const scopeId = (scope: DocumentScope): string => scope.taskId ?? scope.projectId ?? ''

export default function DocumentSurface(props: DocumentSurfaceProps) {
  const qc = useQueryClient()
  const [error, setError] = createSignal('')
  const [ready, setReady] = createSignal(false)

  // Read once at mount and held: a pane is rebuilt on a node switch (the shell keys on the node) and
  // a document surface serves one document per scope, so there is nothing here that can go stale
  // underneath the instance.
  const uri = documentUri(props.pluginId, props.surfaceId)
  const scope = scopeId(props.scope)
  const nodeId = props.nodeId
  const readPath = resolveDocumentRoute(props.region.read, props.scope)
  const writePath = props.region.write ? resolveDocumentRoute(props.region.write, props.scope) : null
  // A language id the manifest parser already checked — re-checked because the manifest reached this
  // device as a roster row, which is bytes a node sent (the rule chrome/data.ts states).
  const language = monacoLanguageFor(isLanguageId(props.region.languageId) ? props.region.languageId : 'plaintext')

  let host: HTMLDivElement | undefined
  let editor: monaco.editor.IStandaloneCodeEditor | undefined
  let model: monaco.editor.ITextModel | undefined
  let stopTheme: (() => void) | undefined
  let disposed = false
  // The version id at the last successful load or save. Dirty is derived from it rather than tracked
  // as a flag, so undoing back to the saved text clears the dot the way it should.
  let savedVersion = 0

  const scheduleSave = debounce(() => void save(), 1500)

  const saveViewState = (): void => {
    const state = editor?.saveViewState()
    if (state) rememberDocumentViewState(nodeId, scope, uri, state)
  }

  // No `disposed` guard on the way IN, deliberately: the last thing an unmounting pane does is flush,
  // and everything up to the `await` — including reading the text out of the model — runs
  // synchronously, so the value is captured before the model is disposed below. Only the state writes
  // afterwards are guarded, because by then the component may be gone.
  async function save(): Promise<void> {
    if (!model || !writePath) return
    const version = model.getAlternativeVersionId() // snapshot: the value we are about to write
    if (version === savedVersion) return
    const text = model.getValue()
    savedVersion = version
    try {
      await writeJson<unknown>(writePath, {
        method: 'PUT',
        nodeId,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text } satisfies PluginDocumentBody),
      })
      if (!disposed) setError('')
    } catch (cause) {
      savedVersion = 0 // the write did not land, so the next change must try again
      if (!disposed) setError(cause instanceof Error ? cause.message : 'Save failed')
    }
  }

  /** The flush every surface action waits on, and the one the frame can ask for by name. */
  const flush = async (): Promise<void> => {
    scheduleSave.cancel()
    await save()
  }

  // A chord pressed with focus inside this editor. It cannot reach the shell's window dispatcher — that
  // one refuses scoped bindings while a typing target has focus, and Monaco's input area is one — and it
  // cannot reach the plugin's frame either, which is in a different document. So the host resolves it
  // here, against the same registry and the same policy PluginFrame uses for chords a frame forwards.
  //
  // Only PANE-scoped bindings are taken. Global and task chords have already had their chance on
  // `window` in the capture phase before Monaco saw the event, and taking them a second time here would
  // fire them twice.
  const onEditorKeyDown = (event: monaco.IKeyboardEvent): void => {
    const chord = eventChord(event.browserEvent)
    if (!chord) return
    const prefs = qc.getQueryData<Record<string, string>>(prefsKey) ?? {}
    const binding = resolveFrameKeybinding(chord, resolveKeybindings(keybindingRegistry.entries(), prefs), {
      pluginId: props.pluginId,
      surface: props.surfaceId,
      // This editor is only ever drawn inside its pane, so its pane being on screen is the fact the
      // scope test is asking about.
      taskActive: true,
    })
    if (binding?.when !== 'pane') return
    event.preventDefault()
    event.stopPropagation()
    // Flush FIRST, then run. This is the contract guarantee: a surface action never fires against a
    // stale document.
    void flush()
      .then(() => executeCommand(binding.command))
      .catch((cause: unknown) => console.error(`[command:${binding.command}]`, cause))
  }

  // One provider per mounted surface, answering only for THIS model. Monaco's completion providers are
  // registered per language and are global, so a second document pane in the same language would
  // otherwise be offered this plugin's items.
  const registerCompletions = (): monaco.IDisposable | null => {
    const completions = props.region.completions
    if (!completions) return null
    const path = resolveDocumentRoute(completions.route, props.scope)
    if (!path) return null
    return monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: [...(completions.triggerCharacters ?? [])],
      provideCompletionItems: async (target, position) => {
        if (!model || target.uri.toString() !== model.uri.toString()) return { suggestions: [] }
        // The word under the cursor, so Monaco replaces it rather than inserting beside it.
        const word = target.getWordUntilPosition(position)
        const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn }
        let items: PluginCompletionItem[]
        try {
          const body = await writeJson<{ items?: PluginCompletionItem[] }>(path, {
            method: 'POST',
            nodeId,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              text: target.getValue(),
              position: { line: position.lineNumber, column: position.column },
            } satisfies PluginCompletionRequest),
          })
          items = Array.isArray(body?.items) ? body.items : []
        } catch {
          // A failed completion is not an error the reader needs told about — the popup simply has
          // nothing in it. The document itself is unaffected, unlike a failed save.
          return { suggestions: [] }
        }
        return {
          suggestions: items.slice(0, MAX_COMPLETION_ITEMS).flatMap((item) => {
            // Route output is bytes a node sent, so the shape is checked rather than believed.
            if (typeof item?.label !== 'string' || !item.label) return []
            return [{
              label: item.label,
              kind: COMPLETION_KIND[item.kind ?? 'text'] ?? COMPLETION_KIND.text,
              insertText: typeof item.insertText === 'string' ? item.insertText : item.label,
              ...(typeof item.detail === 'string' ? { detail: item.detail } : {}),
              range,
            }]
          }),
        }
      },
    })
  }

  onMount(() => {
    let completionProvider: monaco.IDisposable | null = null
    onCleanup(() => {
      props.onHandle?.(null)
      completionProvider?.dispose()
      saveViewState() // pane unmounting (task or workspace switch) — remember where we were
      scheduleSave.cancel()
      void save() // reads the model before the dispose below; the request outlives the component
      disposed = true
      stopTheme?.()
      model?.dispose()
      editor?.dispose()
    })

    void (async () => {
      if (!readPath) return setError('This surface needs a task; open one first.')
      let text: string
      try {
        const body = await readJson<Partial<PluginDocumentBody>>(readPath, { nodeId })
        if (typeof body?.text !== 'string') {
          console.warn(`[document-surface] ${props.pluginId} returned an unusable document:`, body)
          return setError('This plugin returned an unreadable document.')
        }
        // Refused whole rather than trimmed: a truncated document in an editor that will save it back
        // is data loss wearing the shape of a rendering limit.
        if (new TextEncoder().encode(body.text).byteLength > MAX_DOCUMENT_BYTES) {
          return setError(`Document is larger than ${MAX_DOCUMENT_BYTES / 1024 / 1024} MiB.`)
        }
        text = body.text
      } catch (cause) {
        return setError(cause instanceof Error ? cause.message : 'Could not load this document.')
      }
      if (disposed) return
      setReady(true) // renders the host div synchronously
      if (!host) return

      stopTheme = watchMonacoTheme()
      model = monaco.editor.createModel(text, language)
      savedVersion = model.getAlternativeVersionId()
      editor = monaco.editor.create(host, {
        automaticLayout: true,
        theme: MONACO_THEME,
        model,
        readOnly: !writePath, // no write route declared is a real mode, not a degenerate one
        minimap: { enabled: false },
      })
      const state = documentViewState(nodeId, scope, uri) as monaco.editor.ICodeEditorViewState | undefined
      if (state) editor.restoreViewState(state)
      completionProvider = registerCompletions()
      // Surface actions before the read-only bail: a read-only document can still carry an action —
      // "apply this generated migration" is exactly that shape.
      editor.onKeyDown(onEditorKeyDown)
      if (!writePath) {
        // A read-only surface still hands its frame a handle. `write` is the one that has nowhere to go,
        // and it is a no-op rather than a throw: the plugin declared no write route, so it already knows.
        props.onHandle?.({ read: () => model?.getValue() ?? '', write: () => {}, flush: async () => {} })
        return
      }
      // Autosave, with ⌘S as an explicit flush rather than the only way to persist — the same
      // semantics the editor pane has, now owned once instead of per plugin.
      model.onDidChangeContent(() => scheduleSave())
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void flush())
      editor.onDidBlurEditorText(() => scheduleSave.flush())
      // The frame's view of this document. `write` goes through the model, so it lands in the undo stack
      // and schedules the same autosave a keystroke would — loading a saved query is an edit like any
      // other, and ⌘Z after one is what a reader expects.
      props.onHandle?.({
        read: () => model?.getValue() ?? '',
        write: (text) => model?.setValue(text),
        flush,
      })
    })()
  })

  return (
    <section class="pane document-surface">
      <Show when={error()}><Alert class="document-surface-error">{error()}</Alert></Show>
      <Show when={ready()}><div class="document-surface-host" ref={host} /></Show>
    </section>
  )
}
