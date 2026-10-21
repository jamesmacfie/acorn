import { spawn } from 'node:child_process'
import type { ParsedArgs } from './args'

// `acorn mobile` runs the phone gateway (apps/mobile/src/gateway) as a child of this command, so the
// CLI never loads its server, and Ctrl+C closes the gateway's sockets before this command exits.
// The gateway's own entry parses the flags and prints the address and the sign-in code.

const SERVE_FLAGS = ['node', 'port', 'origin', 'app-dir'] as const

/** The gateway's command line for `acorn mobile`, `mobile sessions`, or `mobile revoke ID`. */
export function mobileGatewayArgs(args: ParsedArgs, appDir: string): string[] {
  const [, verb, id] = args.positionals
  if (verb) return id ? [verb, id] : [verb]
  const options: Record<string, string> = { 'app-dir': appDir, ...args.options }
  return SERVE_FLAGS.flatMap((name) => (options[name] === undefined ? [] : [`--${name}`, options[name]]))
}

/** Runs the gateway to its exit and answers its exit code. */
export function runMobileGateway(entry: string, gatewayArgs: string[]): Promise<number> {
  const child = spawn(process.execPath, [entry, ...gatewayArgs], { stdio: 'inherit' })
  // The terminal sends Ctrl+C to both processes. This one waits for the gateway to finish stopping.
  process.on('SIGINT', () => {})
  process.once('SIGTERM', () => child.kill('SIGTERM'))
  return new Promise((done) => {
    child.once('error', (error) => {
      console.error(`Could not start the gateway: ${error.message}`)
      done(1)
    })
    child.once('exit', (code) => done(code ?? 1))
  })
}
