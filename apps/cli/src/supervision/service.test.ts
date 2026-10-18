import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { harnessOnPath, launchAgent, scheduledTask, systemdUnit } from './service'

const spec = {
  shim: '/Users/sam/.local/bin/acorn',
  environment: {
    PATH: '/Users/sam/.local/bin:/opt/homebrew/bin:/usr/bin',
    ACORN_DATA_DIR: '/Users/sam/Library/Application Support/acorn-node/node',
  },
  logDir: '/Users/sam/Library/Application Support/acorn-node/logs',
}

describe('service definitions', () => {
  it('writes a LaunchAgent that restarts the Node only after a crash and outlasts its drain', () => {
    expect(launchAgent({ ...spec, environment: { ...spec.environment, ACORN_DATA_DIR: '/srv/R&D <node>' } })).toBe(
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Written by acorn node service install. Run it again to refresh the PATH this file records. -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>sh.acorn.node</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/sam/.local/bin/acorn</string>
    <string>node</string>
    <string>start</string>
    <string>--foreground</string>
    <string>--log</string>
    <string>/Users/sam/Library/Application Support/acorn-node/logs/node.log</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/Users/sam/.local/bin:/opt/homebrew/bin:/usr/bin</string>
    <key>ACORN_DATA_DIR</key>
    <string>/srv/R&amp;D &lt;node&gt;</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ExitTimeOut</key>
  <integer>45</integer>
  <key>StandardOutPath</key>
  <string>/Users/sam/Library/Application Support/acorn-node/logs/launcher.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/sam/Library/Application Support/acorn-node/logs/launcher.log</string>
</dict>
</plist>
`,
    )
  })

  it('writes a systemd user unit with its specifiers and variables escaped', () => {
    expect(
      systemdUnit({
        shim: '/home/sam/$weird/.local/bin/acorn',
        environment: { PATH: '/home/sam/.local/bin:/usr/bin', ACORN_DATA_DIR: '/data/100% "node"' },
        logDir: '/unused',
      }),
    ).toBe(`# Written by acorn node service install. Run it again to refresh the PATH this file records.
[Unit]
Description=acorn Node

[Service]
Environment="PATH=/home/sam/.local/bin:/usr/bin"
Environment="ACORN_DATA_DIR=/data/100%% \\"node\\""
ExecStart="/home/sam/$$weird/.local/bin/acorn" node start --foreground
Restart=on-failure
RestartSec=5
TimeoutStopSec=45
KillMode=mixed

[Install]
WantedBy=default.target
`)
  })

  it('writes a logon task that runs on battery with no time limit, and a script that records the environment', () => {
    const { script, task } = scheduledTask(
      {
        shim: 'C:\\Users\\Sam\\AppData\\Local\\acorn-node\\bin\\acorn.cmd',
        environment: {
          PATH: 'C:\\Program Files (x86)\\x;%SystemRoot%',
          ACORN_DATA_DIR: 'C:\\Users\\Sam\\AppData\\Local\\acorn-node\\node',
        },
        logDir: 'C:\\unused',
      },
      'C:\\Users\\Sam\\AppData\\Local\\acorn-node\\acorn-node-service.cmd',
      'DESK\\Sam & Co',
    )
    expect(script.split('\r\n')).toEqual([
      '@echo off',
      'rem Written by acorn node service install. Run it again to refresh the PATH this file records.',
      'chcp 65001 >nul',
      'set "PATH=C:\\Program Files (x86)\\x;%%SystemRoot%%"',
      'set "ACORN_DATA_DIR=C:\\Users\\Sam\\AppData\\Local\\acorn-node\\node"',
      '"C:\\Users\\Sam\\AppData\\Local\\acorn-node\\bin\\acorn.cmd" node start --background',
      '',
    ])
    expect(task.split('\r\n')).toEqual([
      '<?xml version="1.0" encoding="UTF-16"?>',
      '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
      '  <RegistrationInfo>',
      '    <Description>Starts the acorn Node when you sign in. Written by acorn node service install.</Description>',
      '  </RegistrationInfo>',
      '  <Triggers>',
      '    <LogonTrigger>',
      '      <UserId>DESK\\Sam &amp; Co</UserId>',
      '    </LogonTrigger>',
      '  </Triggers>',
      '  <Principals>',
      '    <Principal id="Author">',
      '      <UserId>DESK\\Sam &amp; Co</UserId>',
      '      <LogonType>InteractiveToken</LogonType>',
      '      <RunLevel>LeastPrivilege</RunLevel>',
      '    </Principal>',
      '  </Principals>',
      '  <Settings>',
      '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
      '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
      '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
      '    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>',
      '  </Settings>',
      '  <Actions Context="Author">',
      '    <Exec>',
      '      <Command>C:\\Users\\Sam\\AppData\\Local\\acorn-node\\acorn-node-service.cmd</Command>',
      '    </Exec>',
      '  </Actions>',
      '</Task>',
      '',
    ])
  })
})

describe('harnessOnPath', () => {
  it('finds claude or codex on the recorded PATH, with Windows extensions there', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acorn-service-path-'))
    try {
      expect(harnessOnPath(`/missing:${dir}`, 'darwin')).toBe(false)
      writeFileSync(join(dir, 'codex.cmd'), '')
      expect(harnessOnPath(`/missing:${dir}`, 'darwin')).toBe(false)
      expect(harnessOnPath(dir, 'win32')).toBe(true)
      writeFileSync(join(dir, 'claude'), '')
      expect(harnessOnPath(`/missing:${dir}`, 'darwin')).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
