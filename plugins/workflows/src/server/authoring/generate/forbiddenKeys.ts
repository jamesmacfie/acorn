
/** Keys generation cannot safely choose. The catalog does not validate these execution settings,
 *  so grounding strips them before a draft is applied. The built-in kind renderer uses this list
 *  to omit protected fields, including `requiresRun`, from its described fields. */
export const FORBIDDEN_KEYS = ['trigger', 'tools.allow', 'model', 'configOptions', 'requiresRun'] as const

const FORBIDDEN_FIELD_IDS = new Set<string>(FORBIDDEN_KEYS.flatMap((key) => [key, key.split('.').pop() ?? key]))
export const isForbiddenField = (id: string): boolean => FORBIDDEN_FIELD_IDS.has(id) || FORBIDDEN_FIELD_IDS.has(id.split('.').pop() ?? id)
