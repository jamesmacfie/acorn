import { afterEach, describe, expect, it } from 'vitest'
import { ctrlArmed, keyBytes, setCtrlArmed, withCtrl } from './keyRow'

afterEach(() => setCtrlArmed(false))

describe("the phone's key row", () => {
  it('sends Esc, Tab, and arrows in the cursor-key mode the program asked for', () => {
    expect(keyBytes('escape', false)).toBe('\x1b')
    expect(keyBytes('tab', false)).toBe('\t')
    expect(keyBytes('up', false)).toBe('\x1b[A')
    expect(keyBytes('left', false)).toBe('\x1b[D')
    expect(keyBytes('down', true)).toBe('\x1bOB')
    expect(keyBytes('right', true)).toBe('\x1bOC')
  })

  it('turns the next typed character into its control code, once', () => {
    expect(withCtrl('c')).toBe('c')
    setCtrlArmed(true)
    expect(withCtrl('c')).toBe('\x03')
    expect(ctrlArmed()).toBe(false)
    expect(withCtrl('c')).toBe('c')
  })

  it('maps a capital, the punctuation controls, space and ?', () => {
    const ctrl = (character: string): string => {
      setCtrlArmed(true)
      return withCtrl(character)
    }
    expect(ctrl('D')).toBe('\x04')
    expect(ctrl('[')).toBe('\x1b')
    expect(ctrl('_')).toBe('\x1f')
    expect(ctrl(' ')).toBe('\x00')
    expect(ctrl('?')).toBe('\x7f')
  })

  it('passes through what has no control form, and lets go of Ctrl', () => {
    setCtrlArmed(true)
    expect(withCtrl('1')).toBe('1')
    expect(ctrlArmed()).toBe(false)
    setCtrlArmed(true)
    expect(withCtrl('\x1b[A')).toBe('\x1b[A')
    expect(ctrlArmed()).toBe(false)
  })
})
