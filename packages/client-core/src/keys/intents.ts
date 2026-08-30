// The intents. A kit node handles one of these; it never reads a key.
//
// Closed on purpose (docs/command-palette-and-shortcuts.md § Focus and typing, on keys becoming intents before anyone
// sees them). A host maps its own keys onto this set, so a terminal renderer teaches `j` and `k` in
// one table rather than in every component, and a plugin that only ever sees `onActivate` cannot
// grow a keyboard opinion of its own.

export const INTENTS = [
  'next', 'prev', 'first', 'last', 'pageNext', 'pagePrev',
  'expand', 'collapse', 'activate', 'dismiss', 'commit',
  'search', 'menu', 'delete',
  'nextRegion', 'prevRegion', 'nextPane', 'prevPane',
] as const

export type Intent = (typeof INTENTS)[number]

/** Intents that reach a focused `Input`, `Textarea` or `Composer` anyway. Today's `typing-exempt`
 *  scope, as a property of the intent rather than of whoever remembered to declare it. */
export const TYPING_EXEMPT: ReadonlySet<Intent> = new Set<Intent>([
  'dismiss', 'commit', 'nextRegion', 'prevRegion', 'nextPane', 'prevPane',
])
