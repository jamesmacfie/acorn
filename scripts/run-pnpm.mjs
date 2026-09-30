import { execFileSync } from 'node:child_process'

// Run the pnpm CLI with Node so Windows never has to execute a .cmd through execFile.
// Arguments keep their boundaries without a command shell. The standalone pnpm (`@pnpm/exe`) names
// a native executable in npm_execpath rather than a script, so that one runs directly.
export function runPnpm(args, options = {}) {
  const cli = process.env.npm_execpath
  if (cli && /\.[cm]?js$/.test(cli)) return execFileSync(process.execPath, [cli, ...args], options)
  if (cli) return execFileSync(cli, args, options)
  if (process.platform === 'win32') throw new Error('Run this build script through pnpm so npm_execpath names its CLI.')
  return execFileSync('pnpm', args, options)
}
