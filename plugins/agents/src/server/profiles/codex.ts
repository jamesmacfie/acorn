import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type AgentProfileContribution, codexJsonAdapter, registerAcornMcp } from '@acorn/plugin-api/node'
import { codexMcpCommands } from './mcpCommands'
import { codexModels } from './codexModels'

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
  mcpRegistration: (name, launcher) => registerAcornMcp(codexMcpCommands, name, launcher),
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
  // One turn with nothing to act on. Two callers: a workflow `decide` step, and any Generate control
  // spending this CLI as a text backend (docs/integrations.md § Model providers).
  //
  // `--skip-git-repo-check` is required, not a preference, and it is a consequence of a decision taken
  // elsewhere. A one-shot generate runs in an empty temporary directory so the CLI cannot read an
  // `AGENTS.md` and answer with some repo's house rules in front of the caller's prompt
  // (docs/integrations.md § Model providers). Codex refuses to start in a
  // directory that is neither a git repo nor trusted: "Not inside a trusted directory and
  // --skip-git-repo-check was not specified". So the room we chose for it is the reason for the flag.
  //
  // `-s read-only` is the closest codex has to tools off. There is no switch that empties its tool
  // list the way claude's `--tools ''` does, so the one-shot leans on the same empty directory: a
  // read-only tool there has nothing to read.
  //
  // The system half is prepended to the prompt with a blank line between, because `codex exec` has no
  // system-prompt flag. Core never joins them on a profile's behalf, since only the profile knows
  // whether its CLI honoured a flag, so the joining happens here.
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
  // The app-server supplies the account's picker-visible models. An empty default model id keeps the
  // CLI's configured default unless the owner explicitly chooses a model in acorn.
  listModels: codexModels,
  glyph: 'brand:agents/codex',
}
