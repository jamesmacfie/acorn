import { expect, it } from 'vitest'
import { starterTriggerCheck } from '@acorn/protocol/starterTriggers.ts'
import { sessionSourceDescription } from './sessionSource'

it("Agent sessions suggested triggers pass the Node's check", () => {
  const { kept, dropped } = starterTriggerCheck(sessionSourceDescription, sessionSourceDescription.starterTriggers)
  expect(dropped).toEqual([])
  expect(kept.map((starter) => starter.label)).toEqual(['A session needs you'])
})
