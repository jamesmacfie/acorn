import { createHash } from 'node:crypto'

const text = (value, reasoning = false) => ({
  sessionUpdate: reasoning ? 'agent_thought_chunk' : 'agent_message_chunk',
  content: { type: 'text', text: value },
})

function prose(seed) {
  const updates = []
  for (let index = 0; index < 240; index++) {
    const number = index + seed
    if (index % 6 === 0) updates.push(text(`Reasoning checkpoint ${number}: the next six observations follow from the same generated evidence, so their order and wording stay fixed between runs.\n`, true))
    updates.push(text(`## Observation ${number}\n\nThe measured path keeps the source, transformation, and result visible. Repeating the same input gives the same output, so a comparison can attribute a changed cost to the build. This paragraph also exercises *emphasis*, **strong text**, and [a local link](#observation-${number}).\n\n`))
  }
  return updates
}

function code(seed) {
  const updates = [text('```ts\n')]
  for (let index = 0; index < 300; index++) {
    updates.push(text(`export const value${index} = (input: number): number => input + ${index + seed}\n`))
  }
  updates.push(text('```\n'))
  return updates
}

function tools(seed) {
  const updates = []
  for (let index = 0; index < 30; index++) {
    const toolCallId = `replay-${index}`
    updates.push({ sessionUpdate: 'tool_call', toolCallId, title: `Read fixture ${index}`, status: 'in_progress' })
    updates.push({
      sessionUpdate: 'tool_call_update', toolCallId, status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: `Generated output ${index + seed}: ${'sample '.repeat(30)}` } }],
    })
    updates.push(text(`Fixture ${index + 1} is recorded.\n`))
  }
  return updates
}

const builders = { prose, code, tools }

export function replayFixture(name, seed = 1) {
  const build = builders[name]
  if (!build || !Number.isInteger(seed)) throw new Error(`Unknown replay fixture: ${name}`)
  const updates = build(seed)
  const finalText = updates.filter((update) => update.sessionUpdate === 'agent_message_chunk')
    .map((update) => update.content.text).join('')
  return {
    name, seed, delayMs: 40, updates, bytes: Buffer.byteLength(finalText),
    digest: createHash('sha256').update(finalText).digest('hex'),
  }
}
