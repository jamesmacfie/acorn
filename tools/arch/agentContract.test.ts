import { expect, it } from 'vitest'
import type { AgentAttachment } from '../../plugins/agents/src/contract/wire'
import type { DraftAttachment } from '../../packages/plugin-types/src/public'

// The published declaration is independent of the bundled Agents plugin. Assert both directions
// here so neither package imports the other just to check their shared wire shape.
type Mutual<A, B> = [A extends B ? true : never, B extends A ? true : never]
const attachment: Mutual<AgentAttachment, DraftAttachment> = [true, true]

it('keeps published draft attachments aligned with Agents', () => {
  expect(attachment).toEqual([true, true])
})
