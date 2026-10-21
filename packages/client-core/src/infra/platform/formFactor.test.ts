import { afterEach, expect, it } from 'vitest'
import { formFactor } from './index'

// Bare Node, so a `document` is whatever the test says it is.
const rootWith = (dataset: Record<string, string>) =>
  Reflect.set(globalThis, 'document', { documentElement: { dataset } })

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'document')
})

it('is narrow when the root element says so', () => {
  rootWith({ formFactor: 'narrow' })
  expect(formFactor()).toBe('narrow')
})

it('is desktop when the root element says nothing, as the desktop shell leaves it', () => {
  rootWith({})
  expect(formFactor()).toBe('desktop')
})

it('is desktop for a value it does not know', () => {
  rootWith({ formFactor: 'tablet' })
  expect(formFactor()).toBe('desktop')
})

it('is tui where there is no document to read', () => {
  expect(formFactor()).toBe('tui')
})
