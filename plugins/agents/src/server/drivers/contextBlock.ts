// A context part as the text both drivers send. The label and source are attributes and the content is
// the body, and any of the three can come from outside acorn: a loaded plugin's label, a pull request
// body. So a quote cannot end an attribute early and the content cannot close the tag, which would let
// whatever follows read as the reader's own message.
import type { AgentInputPart } from '../../contract/wire.ts'

const attribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// `ref` is the `#keyword:slug` token the message used for this block, so the model can tell which
// block a reference in the text means.
export const contextBlock = (
  part: Pick<Extract<AgentInputPart, { type: 'context' }>, 'source' | 'label' | 'content' | 'ref'>,
): string =>
  `<acorn-context source="${attribute(part.source)}" label="${attribute(part.label)}"${
    part.ref ? ` ref="${attribute(part.ref)}"` : ''
  }>\n${part.content.replace(/<\/acorn-context/gi, '<\\/acorn-context')}\n</acorn-context>`
