// Join class names, dropping empties. The primitives append `props.class` rather than replacing
// their own, which is what makes migration incremental: `<Button class="new-pr-btn">` renders with
// the .ui-btn base plus its existing bespoke rule, so a converted call site looks identical and a
// later commit deletes the bespoke rule once its declarations are expressible as variant + tokens.
//
// Generalises the ad-hoc `` `copy-btn ${props.class ?? ''}` `` that CopyButton/Picker already used.
export const cx = (...parts: (string | false | null | undefined)[]): string =>
  parts.filter(Boolean).join(' ')
