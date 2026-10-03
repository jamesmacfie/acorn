import { execFileSync } from 'node:child_process'

// Run the pnpm CLI with Node so Windows never has to execute a .cmd through execFile.
// Arguments keep their boundaries without a command shell. The standalone pnpm (`@pnpm/exe`) names
// a native executable in npm_execpath rather than a script, so that one runs directly.
export function pnpmInvocation(args) {
  const cli = process.env.npm_execpath
  if (cli && /\.[cm]?js$/.test(cli)) return [process.execPath, [cli, ...args]]
  if (cli) return [cli, args]
  if (process.platform === 'win32') throw new Error('Run this build script through pnpm so npm_execpath names its CLI.')
  return ['pnpm', args]
}

export function runPnpm(args, options = {}) {
  const [command, commandArgs] = pnpmInvocation(args)
  return execFileSync(command, commandArgs, options)
}
