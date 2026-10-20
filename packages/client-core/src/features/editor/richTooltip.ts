// The editor's styling for the shared tooltip body (`richTooltipDom`), which language hover and line
// annotations draw inside CodeMirror tooltips.
import { EditorView } from '@codemirror/view'

export { richTooltipDom, type RichTooltipContent } from '../../kit/lib/rendering/richTooltip'

export const richTooltipTheme = EditorView.baseTheme({
  '.cm-document-hover': { maxWidth: '480px', maxHeight: '320px', overflow: 'auto', padding: '6px 8px' },
  '.cm-document-hover-from': { marginTop: '4px', fontSize: '0.85em', opacity: '0.7' },
})
