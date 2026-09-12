import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type AgentProfileContribution, codexJsonAdapter, registerAcornMcp } from '@acorn/plugin-api/node'

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
  // A contained one-shot run has no writable repository and no projected tools. Codex has no
  // system-prompt flag, so this profile joins the two prompt roles explicitly.
  aiArgv: (command, opts) => ({
    file: command,
    args: [
      'exec',
      '--json',
      '--ephemeral',
      '-s',
      'read-only',
      '--skip-git-repo-check',
      ...(opts.model ? ['-m', opts.model] : []),
      ...(opts.schema ? ['--output-schema', materializeSchema(opts.schema)] : []),
      opts.system ? `${opts.system}\n\n${opts.prompt}` : opts.prompt,
    ],
  }),
  streamJson: codexJsonAdapter,
}
