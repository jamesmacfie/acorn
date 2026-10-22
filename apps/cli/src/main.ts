import { fileURLToPath } from 'node:url'
import { parseCliArgs, helpFor } from './args'
import { runCommand, validateCommand } from './commands'
import { CliError, reportError } from './error'
import { openCliNode } from './node'
import { writeOutput } from './output'
import {
  nodeServiceStatus,
  restartNodeService,
  runNodeForeground,
  startNodeService,
  stopNodeService,
} from './supervision/lifecycle'
import { pluginCommandHelp } from './pluginCommands'
import { mobileGatewayArgs, runMobileGateway } from './mobile'
import { hostTargets, installNativeHost, nativeHostStatus, uninstallNativeHost } from './browser/hostInstall'
import { installNodeService, nodeServiceRegistration, uninstallNodeService } from './supervision/service'

// The native host is its own bundle entry beside this one, so the browser never loads the CLI.
const nativeHostEntry = fileURLToPath(new URL('./native-host.js', import.meta.url))
// The phone gateway is a bundle entry too, and the staged phone app sits beside both
// (scripts/stage.mjs in the desktop app, scripts/pack-node.mjs).
const mobileGatewayEntry = fileURLToPath(new URL('./mobile-gateway.js', import.meta.url))
const mobileAppDir = fileURLToPath(new URL('./mobile', import.meta.url))

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const outputAt = argv.indexOf('--output')
  const requested =
    argv.find((arg) => arg.startsWith('--output='))?.slice('--output='.length) ??
    (outputAt >= 0 ? argv[outputAt + 1] : undefined)
  let output: 'text' | 'json' | 'jsonl' = requested === 'json' || requested === 'jsonl' ? requested : 'text'
  try {
    const args = parseCliArgs(argv)
    output = args.output
    if (
      (args.help && !(args.positionals[0] === 'plugin' && args.positionals.length === 3)) ||
      !args.positionals.length
    ) {
      process.stdout.write(helpFor(args.positionals))
      return 0
    }
    validateCommand(args)
    // Stops a person running the wrong command in a task terminal. It isn't a boundary: an agent can
    // unset both variables, and what keeps it from the device token is the read block
    // (docs/managed-agents/read-block.md), so don't add more environment checks here.
    if (
      (process.env.ACORN_TASK_ID || process.env.ACORN_API_TOKEN) &&
      !(args.positionals[0] === 'task' && args.positionals[1] === 'scripts')
    )
      throw new CliError(
        'task_scope',
        'Task launch credentials permit task scripts commands only; run other CLI commands outside this session.',
        4,
      )
    const verb = args.positionals[1]
    if (args.positionals[0] === 'node' && ['start', 'status', 'stop', 'restart'].includes(verb!)) {
      if (verb === 'start' && args.options.foreground) {
        const outcome = await runNodeForeground(args.options.log)
        if (typeof outcome === 'number') return outcome
        writeOutput(outcome, args)
        return 0
      }
      const result =
        verb === 'start'
          ? await startNodeService()
          : verb === 'status'
            ? await nodeServiceStatus()
            : verb === 'restart'
              ? await restartNodeService()
              : await stopNodeService(args.options.force === 'true')
      writeOutput(result, args)
      return 0
    }
    if (args.positionals[0] === 'node' && verb === 'service') {
      const action = args.positionals[2]
      writeOutput(
        await (action === 'install'
          ? installNodeService()
          : action === 'uninstall'
            ? uninstallNodeService()
            : nodeServiceRegistration()),
        args,
      )
      return 0
    }
    if (args.positionals[0] === 'mobile')
      return await runMobileGateway(mobileGatewayEntry, mobileGatewayArgs(args, mobileAppDir))
    if (args.positionals[0] === 'browser') {
      const targets = hostTargets({
        browser: args.options.browser,
        development: args.options.development === 'true',
        bridgeDir: args.options['bridge-dir'],
        registryDir: args.options['registry-dir'],
      })
      const runtime = { nodeExecutable: process.execPath, hostEntry: nativeHostEntry }
      writeOutput(
        targets.map((target) =>
          verb === 'install'
            ? installNativeHost(target, runtime)
            : verb === 'uninstall'
              ? uninstallNativeHost(target)
              : nativeHostStatus(target),
        ),
        args,
      )
      return 0
    }
    const node = await openCliNode(args.node)
    try {
      if (args.help) {
        process.stdout.write(await pluginCommandHelp(node, args))
        return 0
      }
      const result = await runCommand(node, args)
      if (result !== undefined) writeOutput(result, args)
    } finally {
      node.close()
    }
    return 0
  } catch (error) {
    return reportError(error, output)
  }
}

if (process.argv[1] && /(?:^|\/)cli\.js$/.test(process.argv[1])) process.exitCode = await main()
