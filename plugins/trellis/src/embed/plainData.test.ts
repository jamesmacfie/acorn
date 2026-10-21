import { expect, it } from 'vitest'
import { plainData, plainText } from './plainData'

it('keeps plain data and drops any function a program put on an object', () => {
  const called: string[] = []
  const planted = { toString: () => called.push('toString'), toJSON: () => called.push('toJSON'), a: [1, 'b'] }
  const copy = plainData({ planted, n: Number.NaN, nested: { ok: true, fn: Function } })
  expect(copy).toEqual({ planted: { a: [1, 'b'] }, n: null, nested: { ok: true } })
  expect(JSON.stringify(copy)).toBe('{"planted":{"a":[1,"b"]},"n":null,"nested":{"ok":true}}')
  expect(plainText(planted)).toBe('')
  expect(plainText(3)).toBe('3')
  expect(called).toEqual([])
})
