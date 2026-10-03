import { CliError } from './error'

export type ParsedArgs = {
  node?: string
  output: 'text' | 'json' | 'jsonl'
  noHeader: boolean
  help: boolean
  positionals: string[]
  options: Record<string, string>
}

const valueOptions = new Set([
  'node', 'output', 'workspace', 'project', 'status', 'name', 'path', 'title', 'branch', 'base',
  'patch-file', 'file', 'task', 'session', 'provider', 'profile', 'prompt', 'prompt-file',
  'request-id', 'after-seq', 'limit', 'timeout', 'until', 'definition', 'inputs-file',
  'input-file', 'phase', 'attempt', 'tail', 'max-bytes',
])
const flagOptions = new Set(['help', 'no-header', 'background', 'force', 'skip-setup', 'include-hidden', 'follow', 'check'])

export function parseCliArgs(argv: string[]): ParsedArgs {
  const options: Record<string, string> = {}
  const positionals: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!arg.startsWith('--')) { positionals.push(arg); continue }
    const equal = arg.indexOf('=')
    const name = arg.slice(2, equal < 0 ? undefined : equal)
    const inline = equal < 0 ? undefined : arg.slice(equal + 1)
    if (flagOptions.has(name)) {
      if (inline !== undefined) throw new CliError('usage', `--${name} takes no value.`, 2)
      options[name] = 'true'
    } else if (valueOptions.has(name)) {
      const value = inline ?? argv[++i]
      if (!value || value.startsWith('--')) throw new CliError('usage', `--${name} needs a value.`, 2)
      options[name] = value
    } else throw new CliError('usage', `Unknown option --${name}.`, 2)
  }
  const output = options.output ?? 'text'
  if (output !== 'text' && output !== 'json' && output !== 'jsonl') throw new CliError('usage', `Unknown output format ${output}.`, 2)
  return { node: options.node, output, noHeader: options['no-header'] === 'true', help: options.help === 'true', positionals, options }
}

export function helpFor(positionals: string[]): string {
  const section = positionals[0]
  const lines = section === 'workspace' ? [
      'workspace list|show ID|create --name NAME|rename ID --name NAME|remove ID',
      'workspace external-projects list ID|replace ID --file FILE|- (replaces the full map)',
    ]
    : section === 'project' ? [
      'project list [--workspace ID] [--include-hidden]|show ID',
      'project add --workspace ID --path ABSOLUTE [--name NAME]',
      'project rename ID --name NAME|move ID --workspace ID|hide ID|unhide ID|detect ID|remove ID',
      'project config show ID|set ID --patch-file FILE|- (scripts follow Node trust rules)',
      'project remove deletes related tasks, but leaves folders and worktrees on disk',
    ]
    : section === 'task' ? [
      'task scripts status [TASK_ID] --output json',
      'task scripts wait [TASK_ID] --phase setup|teardown [--attempt ID] [--timeout 5m] [--check]',
      'task scripts logs [TASK_ID] --phase setup|teardown [--attempt ID] [--tail 100] [--max-bytes 32768]',
      'reads never start scripts; task ID omission uses task launch credentials',
      'task list [--project ID] [--status active|archived|all]|show ID',
      'task create --project ID --title TEXT [--branch NAME] [--base BRANCH] [--skip-setup] [--request-id UUID]',
      'a branch and created-trigger setup may prepare a worktree and execute project configuration',
    ]
    : section === 'agent' ? [
      'agent providers|list [--task ID|--workspace ID]|show ID',
      'agent start --task ID --profile ID [--provider ID] --prompt TEXT|--prompt-file FILE|- [--request-id UUID]',
      'agent send ID --prompt TEXT|--prompt-file FILE|- [--request-id UUID]',
      'agent events ID [--after-seq N] [--limit N] [--follow] [--output jsonl]',
      'agent wait ID [--until ready|attention|turn-completed|stopped] [--timeout SECONDS] [--check]',
    ]
    : section === 'workflow' ? [
      'workflow list --task ID',
      'workflow start --task ID --definition ID [--inputs-file FILE|-] [--request-id UUID]',
      'workflow run list --task ID|show ID|steps ID|wait ID [--until finished|attention] [--timeout SECONDS|30m] [--check]',
    ]
    : section === 'run' ? ['run list [--workspace ID] (bounded recent summaries; use owner lists for history)']
    : section === 'plugin' ? ['plugin list|ID commands|ID COMMAND --input-file FILE|- [--request-id UUID]', 'plugin ID COMMAND --help']
    : section === 'node' ? ['node info', 'node start --background', 'node status', 'node stop [--force]']
    : ['node info|start|status|stop', 'workspace list|show|create|rename|remove|external-projects', 'project list|show|add|rename|move|hide|unhide|detect|remove|config', 'task list|show|create|scripts status|scripts wait|scripts logs', 'agent providers|list|show|start|send|events|wait', 'workflow list|start|run list|run show|run steps|run wait', 'run list', 'plugin list|ID commands|ID COMMAND']
  return `Usage: acorn [--node ID|LABEL|https://HOST:PORT] ${lines.join('\n       acorn ')}\n\nOptions: --output text|json|jsonl  --no-header  --help\nExit codes: 0 success, 1 internal, 2 usage, 3 connection/auth/identity/protocol, 4 domain, 5 timeout, 6 failed wait, 7 ambiguous mutation or partial write.\n`
}
