import { parseStructuredRules, validate } from '@openuidev/lang-core'
import { createComponent, createContext, createSignal, useContext, type JSX, type ParentProps } from 'solid-js'

export type FormValidation = ReturnType<typeof createFormValidation>

/**
 * The fields of one form and their errors. A field registers its rules (the validation rules object
 * of the OpenUI spec) and a getter, and a submit button calls `validateForm` before it runs its action.
 */
export function createFormValidation() {
  const fields = new Map<string, { rules: unknown; value: () => unknown }>()
  const [errors, setErrors] = createSignal<Record<string, string | undefined>>({})
  const check = (name: string, value: unknown, rules: unknown) => {
    const error = validate(value, parseStructuredRules(rules))
    setErrors((all) => (all[name] === error ? all : { ...all, [name]: error }))
    return !error
  }
  return {
    error: (name: string) => errors()[name],
    validateField: check,
    registerField(name: string, rules: unknown, value: () => unknown) {
      fields.set(name, { rules, value })
    },
    unregisterField(name: string) {
      fields.delete(name)
    },
    validateForm() {
      return [...fields].map(([name, field]) => check(name, field.value(), field.rules)).every(Boolean)
    },
  }
}

const FormValidationContext = createContext<FormValidation>()

export function FormValidationScope(props: ParentProps<{ validation: FormValidation }>): JSX.Element {
  return createComponent(FormValidationContext.Provider, {
    get value() {
      return props.validation
    },
    get children() {
      return props.children
    },
  })
}

export function useFormValidation(): FormValidation | undefined {
  return useContext(FormValidationContext)
}
