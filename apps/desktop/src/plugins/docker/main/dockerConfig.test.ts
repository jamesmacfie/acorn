import { describe, expect, it } from 'vitest'
import { parseDockerConfig } from './dockerConfig'

describe('parseDockerConfig', () => {
  it('reads the [docker] table', () => {
    expect(parseDockerConfig(`
[docker]
compose_project = "runn"
match_labels = ["acorn.task", 42]
match_name = false
`)).toEqual({ composeProject: 'runn', matchLabels: ['acorn.task'], matchName: false })
  })

  it('ignores missing/foreign tables, bad types, and unparseable toml', () => {
    expect(parseDockerConfig('[scripts.run.dev]\ncommand = "npm run dev"\n')).toEqual({})
    expect(parseDockerConfig('[docker]\ncompose_project = 3\n')).toEqual({})
    expect(parseDockerConfig('docker = "not a table"\n')).toEqual({})
    expect(parseDockerConfig('not toml [[[')).toEqual({})
  })
})
