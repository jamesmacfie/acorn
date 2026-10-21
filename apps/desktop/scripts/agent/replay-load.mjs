import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { cpus } from 'node:os'

// Each child spins one CPU. It checks every hundred million turns that the harness that started it is
// still its parent, so a harness killed outright never leaves CPUs spinning behind it.
const BUSY = 'const parent = process.ppid; for (let turn = 1; ; turn++) if (turn % 1e8 === 0 && process.ppid !== parent) process.exit()'

/**
 * Take `--load [N]` out of a command's arguments. With no number it means one busy process per CPU.
 * Without the flag the load is 0.
 */
export function takeLoadFlag(args) {
  const index = args.indexOf('--load')
  if (index === -1) return { args, load: 0 }
  const value = args[index + 1]
  const counted = /^\d+$/.test(value ?? '')
  const load = counted ? Number(value) : cpus().length
  if (load < 1) throw new Error('--load needs a whole number of busy processes, at least 1.')
  return { args: args.toSpliced(index, counted ? 2 : 1), load }
}

/** Start `count` busy processes. `stop` ends them all and waits until each has exited. */
export function startLoad(count) {
  const children = Array.from({ length: count }, () => spawn(process.execPath, ['-e', BUSY], { stdio: 'ignore' }))
  return {
    pids: children.map((child) => child.pid),
    stop: () => Promise.all(children.map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return
      const exited = once(child, 'exit')
      child.kill()
      await exited
    })),
  }
}
