// What the reference generators share for writing facts into a page: inline code, row anchors, and
// the `ReferenceTable` a fact list is drawn as (docs/site/references.md).
import ts from 'typescript'

export const code = (value) => `\`${value}\``
export const codeList = (values) => values.map(code).join(', ')
export const number = (value) => value.toLocaleString('en-US')
export const anchor = (...parts) =>
  parts
    .join('-')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()

/** A `ReferenceTable`: rows of `{ id, cells, href? }`, drawn with an anchor on each. */
export const table = (head, rows) => `<ReferenceTable head={${JSON.stringify(head)}} rows={${JSON.stringify(rows)}} />`

export const flat = (text) => text.replace(/\s+/g, ' ').trim()
export const docOf = (symbol, checker) => flat(ts.displayPartsToString(symbol.getDocumentationComment(checker)))
export const declarationOf = (symbol) => symbol.valueDeclaration ?? symbol.declarations?.[0]
