import { RangeSetBuilder, StateEffect, StateField, type Extension, type Text } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import type { EditorLineMarkerSet } from '../contract/lineMarkers'

const replaceMarkers = StateEffect.define<readonly EditorLineMarkerSet[]>()

const classFor = (pullRequest: boolean, uncommitted: boolean): string => [
  pullRequest ? 'cm-line-pull-request' : '',
  uncommitted ? 'cm-line-uncommitted' : '',
].filter(Boolean).join(' ')

function decorations(doc: Text, sets: readonly EditorLineMarkerSet[]): DecorationSet {
  const flags = new Uint8Array(doc.lines + 1)
  for (const set of sets) {
    const bit = set.kind === 'pull-request' ? 1 : 2
    for (const range of set.ranges) {
      const from = Math.max(1, range.from)
      const to = Math.min(doc.lines, range.to)
      for (let line = from; line <= to; line++) flags[line] = flags[line]! | bit
    }
  }
  const builder = new RangeSetBuilder<Decoration>()
  for (let line = 1; line <= doc.lines; line++) {
    const flag = flags[line]!
    if (!flag) continue
    builder.add(doc.line(line).from, doc.line(line).from, Decoration.line({
      attributes: { class: classFor(!!(flag & 1), !!(flag & 2)) },
    }))
  }
  return builder.finish()
}

const markerField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (markers, transaction) => {
    let next = markers.map(transaction.changes)
    for (const effect of transaction.effects) {
      if (effect.is(replaceMarkers)) next = decorations(transaction.state.doc, effect.value)
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field),
})

const markerTheme = EditorView.baseTheme({
  // CodeMirror already reserves a small left inset on every line. The bars occupy those pixels, so
  // marked and unmarked code keeps the same alignment. A line in both sets gets two adjacent lanes.
  '.cm-line.cm-line-pull-request': {
    backgroundImage: 'linear-gradient(var(--accent), var(--accent))',
    backgroundPosition: 'left top',
    backgroundRepeat: 'no-repeat',
    backgroundSize: '2px 100%',
  },
  '.cm-line.cm-line-uncommitted': {
    backgroundImage: 'linear-gradient(var(--add-marker), var(--add-marker))',
    backgroundPosition: 'left top',
    backgroundRepeat: 'no-repeat',
    backgroundSize: '2px 100%',
  },
  '.cm-line.cm-line-pull-request.cm-line-uncommitted': {
    backgroundImage: [
      'linear-gradient(var(--accent), var(--accent))',
      'linear-gradient(var(--add-marker), var(--add-marker))',
    ].join(', '),
    backgroundPosition: 'left top, 3px top',
    backgroundRepeat: 'no-repeat',
    backgroundSize: '2px 100%, 2px 100%',
  },
})

export const lineMarkerExtension = (): Extension => [markerField, markerTheme]

export const lineMarkerEffect = (sets: readonly EditorLineMarkerSet[]): StateEffect<readonly EditorLineMarkerSet[]> =>
  replaceMarkers.of(sets)
