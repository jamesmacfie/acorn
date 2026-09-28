// A context part as the text both drivers send. The label and source are attributes and the content is
// the body, and any of the three can come from outside acorn: a loaded plugin's label, a pull request
// body. So a quote cannot end an attribute early and the content cannot close the tag, which would let
// whatever follows read as the reader's own message.
import type { AgentInputPart } from '../../contract/wire.ts'

const attribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const contextBlock = (part: Extract<AgentInputPart, { type: 'context' }>): string =>
  `<acorn-context source="${attribute(part.source)}" label="${attribute(part.label)}">\n${
    part.content.replace(/<\/acorn-context/gi, '<\\/acorn-context')
  }\n</acorn-context>`
