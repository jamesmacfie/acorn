import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { expect, it } from 'vitest'
import { DiffLine, type LineComposerController } from './DiffRows'

it.each(['success', 'failure'] as const)('keeps a successor controller draft when an earlier submission completes with %s', async (outcome) => {
  let resolve!: () => void, reject!: (error: Error) => void
  const pending = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  const [oldBody, setOldBody] = createSignal('submitting draft'), [nextBody, setNextBody] = createSignal('successor draft')
  let oldOpen = true, nextOpen = true
  const old: LineComposerController = { body: oldBody, setBody: setOldBody, isOpen: () => oldOpen, setOpen: (open) => { oldOpen = open } }
  const next: LineComposerController = { body: nextBody, setBody: setNextBody, isOpen: () => nextOpen, setOpen: (open) => { nextOpen = open } }
  const [controller, setController] = createSignal(old)
  const invalidated: string[] = []
  const [invalidator, setInvalidator] = createSignal(() => { invalidated.push('origin') })
  const host = document.createElement('div'); document.body.append(host)
  const dispose = render(() => <DiffLine r={{ kind: 'insert', path: 'fixture.ts', oldNo: null, newNo: 1, raw: 'source', toks: [] }}
    canAdd addComment={() => pending} onMutated={invalidator()} composer={controller()} />, host)
  try {
    const button = [...host.querySelectorAll('button')].find((entry) => entry.textContent === 'Comment')!
    button.click(); setController(next); setInvalidator(() => () => { invalidated.push('successor') })
    const textarea = host.querySelector('textarea')!; textarea.focus(); textarea.setSelectionRange(2, 4)
    if (outcome === 'success') resolve(); else reject(new Error('fixture rejected'))
    await pending.catch(() => {}); await Promise.resolve()
    expect(nextBody()).toBe('successor draft'); expect(nextOpen).toBe(true)
    expect(host.querySelector('textarea')).toBe(textarea); expect(document.activeElement).toBe(textarea); expect(textarea.selectionStart).toBe(2)
    expect(oldBody()).toBe(outcome === 'success' ? '' : 'submitting draft')
    expect(oldOpen).toBe(outcome !== 'success')
    expect(invalidated).toEqual(outcome === 'success' ? ['origin'] : [])
  } finally { dispose(); host.remove() }
})


it('preserves same-key edits made while an earlier body is submitting', async () => {
  let resolve!: () => void
  const pending = new Promise<void>((yes) => { resolve = yes })
  const [body, setBody] = createSignal(' original body ')
  let open = true
  const submitted: string[] = []
  const controller: LineComposerController = { body, setBody, isOpen: () => open, setOpen: (value) => { open = value } }
  const host = document.createElement('div'); document.body.append(host)
  const dispose = render(() => <DiffLine r={{ kind: 'insert', path: 'fixture.ts', oldNo: null, newNo: 1, raw: 'source', toks: [] }}
    canAdd addComment={(text) => { submitted.push(text); return pending }} onMutated={() => {}} composer={controller} />, host)
  try {
    ;([...host.querySelectorAll('button')].find((entry) => entry.textContent === 'Comment')!).click()
    const textarea = host.querySelector('textarea')!; textarea.value = ' edited successor body '
    textarea.dispatchEvent(new Event('input', { bubbles: true })); textarea.focus(); textarea.setSelectionRange(3, 7)
    resolve(); await pending; await Promise.resolve()
    expect(submitted).toEqual(['original body']); expect(body()).toBe(' edited successor body '); expect(open).toBe(true)
    expect(host.querySelector('textarea')).toBe(textarea); expect(textarea.selectionStart).toBe(3)
  } finally { dispose(); host.remove() }
})
