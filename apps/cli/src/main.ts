import { parseCliArgs, helpFor } from './args'
import { runCommand, validateCommand } from './commands'
import { reportError } from './error'
import { openCliNode } from './node'
import { writeOutput } from './output'
import { nodeServiceStatus, startNodeService, stopNodeService } from './supervision/lifecycle'
import { pluginCommandHelp } from './pluginCommands'

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const outputAt = argv.indexOf('--output')
  const requested = argv.find((arg) => arg.startsWith('--output='))?.slice('--output='.length)
    ?? (outputAt >= 0 ? argv[outputAt + 1] : undefined)
  let output: 'text' | 'json' | 'jsonl' = requested === 'json' || requested === 'jsonl' ? requested : 'text'
  try {
    const args = parseCliArgs(argv)
    output = args.output
    if ((args.help && !(args.positionals[0] === 'plugin' && args.positionals.length === 3)) || !args.positionals.length) { process.stdout.write(helpFor(args.positionals)); return 0 }
    validateCommand(args)
    if (args.positionals[0] === 'node' && args.positionals[1] !== 'info') {
      const verb = args.positionals[1]
      const result = verb === 'start' ? await startNodeService()
        : verb === 'status' ? await nodeServiceStatus()
        : await stopNodeService(args.options.force === 'true')
      writeOutput(result, args)
      return 0
    }
    const node = await openCliNode(args.node)
    try {
      if (args.help) { process.stdout.write(await pluginCommandHelp(node, args)); return 0 }
      const result = await runCommand(node, args)
      if (result !== undefined) writeOutput(result, args)
    }
    finally { node.close() }
    return 0
  } catch (error) { return reportError(error, output) }
}

if (process.argv[1] && /(?:^|\/)cli\.js$/.test(process.argv[1])) process.exitCode = await main()
