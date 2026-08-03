// Monaco needs its language services in web workers. Wire them via Vite's `?worker` imports (the
// documented Vite pattern) so they bundle as separate chunks and load from the renderer's own origin,
// which is what `worker-src 'self'` in the app:// CSP (main/appScheme.ts) permits. Import this module
// once before creating an editor.
//
// In the shared kit rather than the editor plugin because the database plugin's SQL editor needs the
// same worker wiring, and it was importing the editor plugin for it — one Monaco environment for the
// renderer, not one per feature that embeds an editor.
// ponytail: full monaco, trim languages only if bundle size ever bites.
//
// The type-only bare import is load-bearing, not decoration: `self.MonacoEnvironment` is declared by
// monaco-editor's own `declare global`, and only the worker sub-paths are imported below — which
// carry no types. In the editor plugin that declaration arrived for free because EditorPane imported
// monaco's API by value in the same program; client-core embeds no editor, so it has to ask.
import type {} from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') return new JsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  },
}
