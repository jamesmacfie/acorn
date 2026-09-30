import { execFileSync } from 'node:child_process'

// Run the pnpm CLI with Node so Windows never has to execute a .cmd through execFile.
// Arguments keep their boundaries without a command shell.
export function runPnpm(args, options = {}) {
  const cli = process.env.npm_execpath
  // Only a JavaScript entry runs under Node. The standalone `@pnpm/exe` install names a native binary here.
  if (cli && /\.[cm]?js$/.test(cli)) return execFileSync(process.execPath, [cli, ...args], options)
  if (process.platform === 'win32') throw new Error('Run this build script through pnpm so npm_execpath names its CLI.')
  return execFileSync('pnpm', args, options)
}
