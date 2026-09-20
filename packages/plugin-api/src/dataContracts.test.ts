import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import * as node from '@acorn/plugin-api/node'
import * as client from '@acorn/plugin-api/client'

it('the installed-source schema is consumable through both public facades', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../../apps/node/test/__fixtures__/typed-source/schema.json', import.meta.url), 'utf8'))
  for (const api of [node, client]) {
    const schema = api.parseDataSchema(fixture.schema)
    expect(api.validateDataValue(fixture.record, schema)).toEqual(fixture.record)
    expect(api.dataFieldsSchema.parse(fixture.fields)).toEqual(fixture.fields)
    expect(api.readDataPointer(fixture.record, '/labels')).toEqual([{ id: 'a', name: 'First' }])
    expect(api.readDataPointer(fixture.record, '/owner')).toBeNull()
    expect(api.readDataPointer(fixture.record, '/project')).toBe(api.MISSING)
  }
})
