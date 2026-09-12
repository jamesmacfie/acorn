import { createRoot } from 'solid-js'
import { describe, expect, it } from 'vitest'
import { layoutTree } from '../layout/pass'
import { frameRequested } from './frames'
import {
  createElement,
  createTextNode,
  getFirstChild,
  getNextSibling,
  getParentNode,
  insertNode,
  isTextNode,
  removeNode,
  replaceText,
  setProperty,
} from './renderer'
import { runText } from './node'

// The ten node operations, against a tree built by hand rather than by the transform, because what is
// under test is the operations and not Solid.
//
// It runs on the Node the repo pins with no FFI and no flag, like every drawing test here does now.
// That was the point of the whole programme.

/** A box carrying a `flexGrow` that identifies it. `getChild` returns a fresh wrapper around the same
 *  wasm pointer on every call, so a node's Yoga child cannot be recognised by identity; a distinct
 *  style value read back off it is the next best thing. */
const tagged = (mark: number) => {
  const node = createElement('box')
  setProperty(node, 'flexGrow', mark)
  return node
}

const yogaOrder = (parent: { yoga: { getChildCount(): number; getChild(index: number): { getFlexGrow(): number } } | null }) =>
  Array.from({ length: parent.yoga!.getChildCount() }, (_, index) => parent.yoga!.getChild(index).getFlexGrow())

describe('the node operations', () => {
  it('makes a node with a Yoga node for the kinds that lay out, and none for the kinds that do not', () => {
    expect(createElement('box').yoga).not.toBeNull()
    expect(createElement('scrollbox').yoga).not.toBeNull()
    expect(createElement('text').yoga).not.toBeNull()
    // A `span` and a `#text` are measured as part of their parent `text`'s one run, and Yoga aborts
    // on a child under a node with a measure function, so neither gets a node of its own.
    expect(createElement('span').yoga).toBeNull()
    expect(createTextNode('hello').yoga).toBeNull()
  })

  it('refuses a tag it has no kind for', () => {
    // A surface on the wrong host says so rather than drawing an empty box.
    expect(() => createElement('main')).toThrow(/Unknown component type/)
    expect(() => createElement('anything_at_all')).toThrow(/Unknown component type/)
  })

  it('links a child, inserts its Yoga child at the matching index, and asks for a frame', () => {
    const parent = createElement('box')
    // Tagged with a `flexGrow` each rather than compared by identity: `getChild` hands back a fresh
    // wrapper around the same wasm pointer every call, so two wrappers for one node are not `===`.
    const first = tagged(1)
    const third = tagged(3)
    insertNode(parent, first)
    insertNode(parent, third)
    const second = tagged(2)
    insertNode(parent, second, third)

    expect(parent.children).toEqual([first, second, third])
    expect(yogaOrder(parent)).toEqual([1, 2, 3])
    expect(frameRequested()).toBe(true)
  })

  it('skips the Yoga slots of children that have no Yoga node', () => {
    // A `text` holding a `span` between two `#text` runs: three tree children, no Yoga children. A
    // box holding a `#text` beside a box is the same question the other way round, and it is the
    // orphan-text shape the old reconciler patch used to wrap on the way in.
    const box = createElement('box')
    const loose = createTextNode('7')
    const after = tagged(7)
    insertNode(box, loose)
    insertNode(box, after)
    expect(box.children).toEqual([loose, after])
    expect(yogaOrder(box)).toEqual([7])
  })

  it('refuses a box inside a text rather than letting the wasm module abort', () => {
    // Yoga prints two lines to stderr and aborts when a node with a measure function gains a child.
    // stderr in a TUI paints over the frame, so this is a throw with an instruction in it instead.
    const text = createElement('text')
    expect(() => insertNode(text, createElement('box'))).toThrow(/use a <span>/)
    // A run is still welcome, which is the whole of what a `text` may hold.
    expect(() => insertNode(text, createTextNode('fine'))).not.toThrow()
    expect(() => insertNode(text, createElement('span'))).not.toThrow()
  })

  it('reads the tree back through the four getters', () => {
    const parent = createElement('box')
    const first = createElement('box')
    const second = createTextNode('two')
    insertNode(parent, first)
    insertNode(parent, second)

    expect(getParentNode(first)).toBe(parent)
    expect(getParentNode(parent)).toBeUndefined()
    expect(getFirstChild(parent)).toBe(first)
    expect(getNextSibling(first)).toBe(second)
    expect(getNextSibling(second)).toBeUndefined()
    expect(isTextNode(second)).toBe(true)
    expect(isTextNode(first)).toBe(false)
  })

  it('moves a node rather than double-linking it when it is inserted somewhere else', () => {
    const from = createElement('box')
    const to = createElement('box')
    const moved = tagged(4)
    insertNode(from, moved)
    insertNode(to, moved)

    expect(from.children).toEqual([])
    expect(yogaOrder(from)).toEqual([])
    expect(to.children).toEqual([moved])
    expect(yogaOrder(to)).toEqual([4])
    expect(moved.parent).toBe(to)
  })

  it('stores a prop, applies the ones Yoga has a setter for, and asks for a frame', () => {
    const box = createElement('box')
    setProperty(box, 'flexGrow', 1)
    setProperty(box, 'borderStyle', 'single')

    expect(box.yoga!.getFlexGrow()).toBe(1)
    // A prop with no setter is still stored, because paint reads the same bag.
    expect(box.props.borderStyle).toBe('single')
    expect(frameRequested()).toBe(true)
  })

  it('re-measures the owning text when a run is replaced', () => {
    const text = createElement('text')
    const run = createTextNode('one')
    insertNode(text, run)
    layoutTree(text, 40, 10)
    expect(text.yoga!.isDirty()).toBe(false)

    replaceText(run, 'one two three')
    expect(runText(text)).toBe('one two three')
    expect(text.yoga!.isDirty()).toBe(true)
  })

  it('keeps a removed node and its Yoga node, because Suspense hands the same instance back', () => {
    // The destroy-on-detach race, as a test. OpenTUI destroyed a renderable a tick after it left the
    // tree; `Suspense` removes its children when it suspends and hands the *same instances* back when
    // it resolves, so any boundary that suspended twice went permanently blank
    // (docs/tui.md § Rendering).
    createRoot((dispose) => {
      const parent = createElement('box')
      const suspended = tagged(5)
      insertNode(parent, suspended)
      const yoga = suspended.yoga

      removeNode(parent, suspended)
      expect(suspended.parent).toBeNull()
      expect(yogaOrder(parent)).toEqual([])
      expect(suspended.yoga).toBe(yoga)

      insertNode(parent, suspended)
      expect(suspended.yoga).toBe(yoga)
      expect(yogaOrder(parent)).toEqual([5])
      dispose()
    })
  })

  it('frees the Yoga node when the owner that made it is disposed', () => {
    let node = createElement('box')
    createRoot((dispose) => {
      node = createElement('box')
      expect(node.yoga).not.toBeNull()
      dispose()
    })
    expect(node.yoga).toBeNull()
  })

  it('unlinks before it frees, so a parent is never left holding a freed pointer', () => {
    // `free()` on a still-attached node does not throw; it leaves a dangling child in the parent,
    // which the next pass reads. So the unlink has to come first, and this is the assertion that
    // says it did.
    const parent = createElement('box')
    createRoot((dispose) => {
      insertNode(parent, tagged(9))
      expect(yogaOrder(parent)).toEqual([9])
      dispose()
    })
    expect(yogaOrder(parent)).toEqual([])
    expect(() => layoutTree(parent, 40, 10)).not.toThrow()
  })

  it('frees on removal a node that no owner will ever re-insert', () => {
    // Created outside any reactive scope, so nothing will hand it back and holding the pointer would
    // be a leak rather than a kindness.
    const parent = createElement('box')
    const orphan = createElement('box')
    insertNode(parent, orphan)
    removeNode(parent, orphan)
    expect(orphan.yoga).toBeNull()
  })
})
