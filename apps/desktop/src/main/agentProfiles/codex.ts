import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerAcornMcp } from '../mcpRegister'
import { lineDelimitedJsonAdapter } from './streamJson'
import type { AgentProfileContribution } from './types'

function materializeSchema(schema: object): string {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-schema-'))
  const file = join(dir, 'schema.json')
  writeFileSync(file, JSON.stringify(schema), 'utf8')
  return file
}

export const codexProfile: AgentProfileContribution = {
  id: 'codex',
  label: 'Codex',
  kind: 'agent',
  command: 'codex',
  backendPreference: 'tmux',
  transport: 'pty',
  mcpRegistration: (name, launcher) => registerAcornMcp('codex', name, launcher),
  headlessArgv: (command, opts) => ({
    file: command,
    args: [
      'exec',
      '--json',
      ...(opts.model ? ['-m', opts.model] : []),
      ...(opts.schema ? ['--output-schema', materializeSchema(opts.schema)] : []),
      opts.prompt,
    ],
  }),
  resumeArgv: (command, sessionRef) => ({ file: command, args: ['resume', sessionRef] }),
  streamJson: lineDelimitedJsonAdapter,
}

