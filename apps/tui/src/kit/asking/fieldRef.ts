import { createEffect, createSignal, untrack } from 'solid-js'
import type { Renderable } from '../../tree/compat'
import { focusedRenderable, moveStop } from '../../keys/regions'
import { bindKeys } from '../../keys/install'
import { STOP } from '../../keys/tiers'
import { create, edit, paste, setValue, type Field, type Press } from '../field'
import { toVisual, wrapRows, type Row } from '../../wrap'
import { requestFrame } from '../../tree/frames'
import type { Node } from '../../tree/node'

/** The edit methods installed on each input renderable for typing and composition. */
export type FieldApi = {
  value: string
  plainText: string
  setText: (text: string) => void
  insertText: (text: string) => void
  handleKeyPress: (key: Press) => boolean
  handlePaste: (event: { text: string }) => void
}

/**
 * Keep editing in a Solid signal and write paint state to the renderable.
 * `newline` selects wrapping and vertical scrolling; single-line fields scroll horizontally.
 */
export function fieldRef(spec: {
  value: () => string
  newline: boolean
  masked?: boolean
  onInput?: (value: string) => void
  onSubmit?: (value: string) => void
}): (element: unknown) => void {
  const [model, setModel] = createSignal<Field>(create(spec.value()))
  const [box, setBox] = createSignal<Node>()
  const [scroll, setScroll] = createSignal(0)

  // Focus comes from the region store, the same source used by other stops.
  const focused = (): boolean => {
    const node = box()
    return !!node && focusedRenderable() === (node as unknown as Renderable)
  }

  // Compute rows from the model. The paint cache depends on props written by an effect below.
  const rows = (text: string): readonly Row[] => {
    const node = box()
    return wrapRows(text, spec.newline && node ? Math.max(node.rect.w, 1) : Infinity)
  }

  // Keep the caret visible horizontally or vertically, according to the field mode.
  const follow = (field: Field, lines: readonly Row[]): void => {
    const node = box()
    if (!node) return
    const here = toVisual(field.text, lines, field.cursor, field.assoc)
    const room = Math.max(spec.newline ? node.rect.h : node.rect.w, 1)
    const at = spec.newline ? here.row : here.col
    setScroll((was) => {
      if (at < was) return at
      // Reserve one cell for the caret after the last character.
      if (at > was + room - 1) return at - room + 1
      return was
    })
  }

  const apply = (next: Field): void => {
    const changed = next.text !== untrack(model).text
    setModel(next)
    if (changed) spec.onInput?.(next.text)
    follow(next, rows(next.text))
  }

  const handleKeyPress = (key: Press): boolean => {
    const field = untrack(model)
    const next = edit(field, key, rows(field.text), spec.newline)
    if (next !== false) {
      apply(next)
      return true
    }
    // Submit is a field action, not an edit operation.
    if (!spec.newline && (key.name === 'return' || key.name === 'linefeed') && !key.ctrl && !key.meta) {
      spec.onSubmit?.(field.text)
      return true
    }
    return false
  }

  // Reset scroll when an external value replaces the buffer.
  const write = (text: string): void => {
    setModel((was) => setValue(was, text))
    setScroll(0)
  }

  // Read the model untracked so typing does not make the external value overwrite it.
  createEffect(() => {
    const incoming = spec.value()
    if (untrack(model).text !== incoming) write(incoming)
  })

  // Paint reads component-owned state from node props; callers cannot set these fields.
  createEffect(() => {
    const node = box()
    if (!node) return
    const field = model()
    // Keep password text out of the cell tree and captured snapshots.
    node.props.value = spec.masked ? '*'.repeat(field.text.length) : field.text
    node.props.cursor = field.cursor
    node.props.assoc = field.assoc
    node.props.scroll = scroll()
    node.props.focused = focused()
    // Only textareas have a Yoga measure function. Marking an input dirty aborts Yoga.
    // Use the node handle to keep the layout module out of the eager app graph.
    if (spec.newline) node.yoga?.markDirty()
    requestFrame()
  })

  const api: FieldApi = {
    get value() { return model().text },
    get plainText() { return model().text },
    set value(text: string) { write(text) },
    setText: write,
    insertText: (text: string) => { apply(paste(untrack(model), text, spec.newline)) },
    handleKeyPress,
    handlePaste: (event: { text: string }) => { apply(paste(untrack(model), event.text, spec.newline)) },
  }

  // Tab walks controls while one is available; at the edge it passes to the region layer.
  const step = (delta: 1 | -1) => (): boolean => {
    const before = focusedRenderable()
    moveStop(delta)
    return focusedRenderable() !== before
  }

  return (element: unknown) => {
    const node = element as Node
    setBox(node)
    // Preserve live getters; spreading would copy their value at mount.
    Object.defineProperties(node, Object.getOwnPropertyDescriptors(api))
    // STOP is above the typing shadow and bound to the field itself.
    bindKeys(node as unknown as Renderable, [
      { key: 'tab', cmd: step(1) },
      { key: 'shift+tab', cmd: step(-1) },
    ], STOP, { mode: 'focus' })
  }
}
