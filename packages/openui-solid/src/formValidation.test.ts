import { createRoot } from 'solid-js'
import { describe, expect, it } from 'vitest'
import { createFormValidation } from './formValidation.ts'

describe('createFormValidation', () => {
  it('checks every registered field and keeps each error until the field passes', () => {
    createRoot((dispose) => {
      const form = createFormValidation()
      let email = ''
      form.registerField('email', { required: true, email: true }, () => email)
      form.registerField('note', { maxLength: 3 }, () => 'ok')

      expect(form.validateForm()).toBe(false)
      expect(form.error('email')).toBeTruthy()
      expect(form.error('note')).toBeUndefined()

      email = 'a@b.co'
      expect(form.validateForm()).toBe(true)
      expect(form.error('email')).toBeUndefined()

      form.unregisterField('email')
      email = ''
      expect(form.validateForm()).toBe(true)
      dispose()
    })
  })
})
