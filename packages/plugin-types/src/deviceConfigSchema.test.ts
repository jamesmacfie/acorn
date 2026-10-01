import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { deviceConfigSchema } from '@acorn/protocol/deviceConfig.ts'

const PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'acorn-device.schema.json')
const generate = (): string => JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://acorn.sh/schemas/acorn-device.schema.json',
  title: 'acorn device configuration',
  ...z.toJSONSchema(deviceConfigSchema, { io: 'input', unrepresentable: 'any' }),
}, null, 2) + '\n'

it('keeps the published device config schema generated from the parser', () => {
  const generated = generate()
  if (process.env.UPDATE_DEVICE_SCHEMA) writeFileSync(PATH, generated)
  expect(JSON.parse(generated).properties).toHaveProperty('plugins')
  expect(readFileSync(PATH, 'utf8')).toBe(generated)
})
