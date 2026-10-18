import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { dataRootDir } from '@acorn/custody/local'
import { CliError } from '../error'
import { nodeServiceStatus, stopNodeService } from './lifecycle'

// `acorn node service install|uninstall|status`: start the installed Node at login, and restart it after
// a crash where the platform can, through the platform's own service manager. Both archive installers
// call these commands, so each platform's file is written here only (docs/node-distribution/install.md).

type NodeServiceRegistration = {
  apiVersion: 'acorn.cli/v1'
  kind: 'NodeServiceRegistration'
  manager: 'launchd' | 'systemd' | 'task-scheduler'
  file: string
  loaded: boolean
  running: boolean
  problem: string | null
}

/** What every platform's definition records: the installed command, and the environment of the shell
 *  that ran `install`, so the Node finds the same `claude` and `codex` the person does. */
type ServiceSpec = { shim: string; environment: Record<string, string>; logDir: string }

const LABEL = 'sh.acorn.node'
const UNIT = 'acorn-node'
const TASK = 'acorn node'
const START_TIMEOUT_MS = 120_000

/** Where install.sh and install.ps1 put the Node. Keep the three in step. */
function installRoot(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'acorn-node')
  if (process.platform === 'win32')
    return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'acorn-node')
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'acorn-node')
}

const shimPath = (): string =>
  process.platform === 'win32' ? join(installRoot(), 'bin', 'acorn.cmd') : join(homedir(), '.local', 'bin', 'acorn')

const xml = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

export function launchAgent(spec: ServiceSpec): string {
  const strings = (values: string[]) => values.map((value) => `    <string>${xml(value)}</string>`)
  const log = join(spec.logDir, 'node.log')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<!-- Written by acorn node service install. Run it again to refresh the PATH this file records. -->',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${LABEL}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...strings([spec.shim, 'node', 'start', '--foreground', '--log', log]),
    '  </array>',
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    ...Object.entries(spec.environment).flatMap(([key, value]) => [
      `    <key>${key}</key>`,
      `    <string>${xml(value)}</string>`,
    ]),
    '  </dict>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    // Restart after a crash only. `acorn node stop` drains the Node and exits 0, so it stays stopped.
    '  <key>KeepAlive</key>',
    '  <dict>',
    '    <key>SuccessfulExit</key>',
    '    <false/>',
    '  </dict>',
    // launchd kills a job 20 seconds after SIGTERM by default, inside the Node's 30-second drain.
    '  <key>ExitTimeOut</key>',
    '  <integer>45</integer>',
    // The launcher's own errors, from before the Node writes to node.log.
    '  <key>StandardOutPath</key>',
    `  <string>${xml(join(spec.logDir, 'launcher.log'))}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${xml(join(spec.logDir, 'launcher.log'))}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n')
}

// systemd expands % specifiers in both settings, and $ variables in ExecStart.
const systemdQuote = (value: string): string =>
  `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%')}"`

export function systemdUnit(spec: ServiceSpec): string {
  return [
    '# Written by acorn node service install. Run it again to refresh the PATH this file records.',
    '[Unit]',
    'Description=acorn Node',
    '',
    '[Service]',
    ...Object.entries(spec.environment).map(([key, value]) => `Environment=${systemdQuote(`${key}=${value}`)}`),
    `ExecStart=${systemdQuote(spec.shim).replaceAll('$', () => '$$')} node start --foreground`,
    'Restart=on-failure',
    'RestartSec=5',
    // Covers the Node's 30-second drain.
    'TimeoutStopSec=45',
    // SIGTERM to the launcher alone. It forwards the stop, and the Node stops its own children.
    'KillMode=mixed',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n')
}

/** The task runs a script, because a scheduled task can't set environment variables. `--background`
 *  returns once the Node answers, so the script's console window closes, and Windows never restarts it. */
export function scheduledTask(spec: ServiceSpec, script: string, user: string): { script: string; task: string } {
  // A batch file expands %, and reads its lines in the console's code page unless told otherwise.
  const set = (key: string, value: string) => `set "${key}=${value.replaceAll('%', '%%')}"`
  return {
    script: [
      '@echo off',
      'rem Written by acorn node service install. Run it again to refresh the PATH this file records.',
      'chcp 65001 >nul',
      ...Object.entries(spec.environment).map(([key, value]) => set(key, value)),
      `"${spec.shim}" node start --background`,
      '',
    ].join('\r\n'),
    task: [
      '<?xml version="1.0" encoding="UTF-16"?>',
      '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
      '  <RegistrationInfo>',
      '    <Description>Starts the acorn Node when you sign in. Written by acorn node service install.</Description>',
      '  </RegistrationInfo>',
      '  <Triggers>',
      '    <LogonTrigger>',
      `      <UserId>${xml(user)}</UserId>`,
      '    </LogonTrigger>',
      '  </Triggers>',
      '  <Principals>',
      '    <Principal id="Author">',
      `      <UserId>${xml(user)}</UserId>`,
      '      <LogonType>InteractiveToken</LogonType>',
      '      <RunLevel>LeastPrivilege</RunLevel>',
      '    </Principal>',
      '  </Principals>',
      // A task's defaults skip a start on battery and stop the task after three days.
      '  <Settings>',
      '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
      '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
      '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
      '    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>',
      '  </Settings>',
      '  <Actions Context="Author">',
      '    <Exec>',
      `      <Command>${xml(script)}</Command>`,
      '    </Exec>',
      '  </Actions>',
      '</Task>',
      '',
    ].join('\r\n'),
  }
}

const run = (command: string, args: string[]) => spawnSync(command, args, { encoding: 'utf8' })

function must(command: string, args: string[]): void {
  const result = run(command, args)
  if (result.status !== 0) {
    const reason = (result.stderr || result.stdout || result.error?.message || '').trim()
    throw new CliError('service_failed', `${command} ${args.join(' ')} failed: ${reason}`, 4)
  }
}

type Manager = {
  manager: NodeServiceRegistration['manager']
  file: string
  // Where to read the Node's output when the service doesn't start it.
  logHint: string
  /** Writes the definition and starts the Node through it. Answers a problem to report, if any. */
  install(spec: ServiceSpec): string | null
  uninstall(): void
  loaded(): boolean
}

function platformManager(): Manager {
  if (process.platform === 'darwin') {
    const file = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)
    const domain = `gui/${process.getuid!()}`
    return {
      manager: 'launchd',
      file,
      logHint: `See ${join(installRoot(), 'logs')}.`,
      install(spec) {
        mkdirSync(spec.logDir, { recursive: true, mode: 0o700 })
        mkdirSync(dirname(file), { recursive: true })
        // Fails harmlessly when nothing is loaded yet.
        run('launchctl', ['bootout', `${domain}/${LABEL}`])
        writeFileSync(file, launchAgent(spec))
        must('launchctl', ['bootstrap', domain, file])
        return null
      },
      uninstall() {
        run('launchctl', ['bootout', `${domain}/${LABEL}`])
        rmSync(file, { force: true })
      },
      loaded: () => run('launchctl', ['print', `${domain}/${LABEL}`]).status === 0,
    }
  }
  if (process.platform === 'win32') {
    const file = join(installRoot(), 'acorn-node-service.cmd')
    return {
      manager: 'task-scheduler',
      file,
      logHint: 'Run acorn node status for its log file.',
      install(spec) {
        const user = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${userInfo().username}` : userInfo().username
        const { script, task } = scheduledTask(spec, file, user)
        writeFileSync(file, script)
        const definition = join(installRoot(), 'acorn-node-task.xml')
        // schtasks reads a task definition as UTF-16 with a byte order mark.
        writeFileSync(definition, Buffer.from(`﻿${task}`, 'utf16le'))
        try {
          must('schtasks', ['/Create', '/TN', TASK, '/XML', definition, '/F'])
        } finally {
          rmSync(definition, { force: true })
        }
        must('schtasks', ['/Run', '/TN', TASK])
        return null
      },
      uninstall() {
        run('schtasks', ['/Delete', '/TN', TASK, '/F'])
        rmSync(file, { force: true })
      },
      loaded: () => run('schtasks', ['/Query', '/TN', TASK]).status === 0,
    }
  }
  const file = join(homedir(), '.config', 'systemd', 'user', `${UNIT}.service`)
  return {
    manager: 'systemd',
    file,
    logHint: `Run journalctl --user -u ${UNIT} to read its log.`,
    install(spec) {
      if (run('systemctl', ['--user', 'show-environment']).status !== 0)
        throw new CliError(
          'service_unavailable',
          'This machine has no systemd user manager. Start the Node from your login script with acorn node start --background instead.',
          4,
        )
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, systemdUnit(spec))
      must('systemctl', ['--user', 'daemon-reload'])
      must('systemctl', ['--user', 'enable', '--now', UNIT])
      // Lingering starts the user manager at boot and keeps it after logout, so an SSH session can end.
      if (run('loginctl', ['enable-linger']).status === 0) return null
      return `The Node stops when you log out. To keep it running, run sudo loginctl enable-linger ${userInfo().username}.`
    },
    uninstall() {
      run('systemctl', ['--user', 'disable', '--now', UNIT])
      rmSync(file, { force: true })
      run('systemctl', ['--user', 'daemon-reload'])
    },
    loaded: () => run('systemctl', ['--user', 'is-enabled', '--quiet', UNIT]).status === 0,
  }
}

export function harnessOnPath(path: string, platform = process.platform): boolean {
  const names = ['claude', 'codex'].flatMap((name) => (platform === 'win32' ? [`${name}.exe`, `${name}.cmd`] : [name]))
  return path.split(delimiter).some((dir) => dir && names.some((name) => existsSync(join(dir, name))))
}

async function registration(manager: Manager, problem: string | null): Promise<NodeServiceRegistration> {
  const loaded = manager.loaded()
  return {
    apiVersion: 'acorn.cli/v1',
    kind: 'NodeServiceRegistration',
    manager: manager.manager,
    file: manager.file,
    loaded,
    running: (await nodeServiceStatus()).state === 'running',
    problem: problem ?? (loaded ? null : 'Not installed. Run acorn node service install.'),
  }
}

export async function installNodeService(): Promise<NodeServiceRegistration> {
  const shim = shimPath()
  if (!existsSync(shim))
    throw new CliError(
      'not_installed',
      `The service runs the installed acorn at ${shim}, which is missing. Install the Node with the archive's installer first.`,
      4,
    )
  const manager = platformManager()
  const root = dataRootDir()
  const environment: Record<string, string> = { PATH: process.env.PATH ?? '', ACORN_DATA_DIR: root }
  // The CLI keeps the Node's device token under these, and `acorn node pair` must find the same one.
  for (const key of ['HOME', 'XDG_CONFIG_HOME']) if (process.env[key]) environment[key] = process.env[key]
  // The service's launcher must own the Node, so a Node started by hand stops first.
  await stopNodeService(false, root)
  const problems = [manager.install({ shim, environment, logDir: join(installRoot(), 'logs') })]
  if (!harnessOnPath(environment.PATH))
    problems.push(
      'Neither claude nor codex is on the PATH the service records, so the Node finds no agent harness. Install one, then run acorn node service install again.',
    )
  const deadline = Date.now() + START_TIMEOUT_MS
  while ((await nodeServiceStatus(root)).state !== 'running') {
    if (Date.now() >= deadline) {
      problems.push(`The service didn't start the Node within two minutes. ${manager.logHint}`)
      break
    }
    await delay(500)
  }
  return registration(manager, problems.filter(Boolean).join(' ') || null)
}

export async function uninstallNodeService(): Promise<NodeServiceRegistration> {
  const manager = platformManager()
  await stopNodeService(false)
  manager.uninstall()
  return registration(manager, 'Removed. The Node no longer starts at login.')
}

export const nodeServiceRegistration = (): Promise<NodeServiceRegistration> => registration(platformManager(), null)
