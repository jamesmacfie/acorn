# Installs this extracted acorn Node archive for the current user, upgrades an earlier install, or
# removes it. The layout and each step are in docs/node-distribution/install.md. Windows blocks a
# downloaded script, so run it with:
#
#   powershell -ExecutionPolicy Bypass -File install.ps1 [-Service | -NoService] [-Force]
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall [-Purge]
param([switch]$Service, [switch]$NoService, [switch]$Force, [switch]$Uninstall, [switch]$Purge)
$ErrorActionPreference = 'Stop'

function Fail([string]$message) {
  [Console]::Error.WriteLine("install.ps1: $message")
  exit 1
}

# A Node runs agents with its user's rights, and a per-user install needs no administrator.
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ((New-Object Security.Principal.WindowsPrincipal $identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Fail 'run this from a PowerShell window that is not elevated, as the person who will use the Node.'
}

$here = $PSScriptRoot
$build = Join-Path $here 'BUILD'
if (-not (Test-Path $build)) { Fail "run this from an extracted acorn Node archive. $here has no BUILD file." }
$version = ((Get-Content $build) -match '^version=' | Select-Object -First 1) -replace '^version=', ''
# installRoot in apps/cli/src/supervision/service.ts and appDataDir in packages/custody/src/local/paths.ts
# name the same folders.
$root = Join-Path $env:LOCALAPPDATA 'acorn-node'
$bin = Join-Path $root 'bin'
$shim = Join-Path $bin 'acorn.cmd'
$current = Join-Path $root 'current'
$installed = Join-Path $current 'bin\acorn.cmd'
$data = if ($env:ACORN_DATA_DIR) { $env:ACORN_DATA_DIR } else { Join-Path $root 'node' }
$env:ACORN_DATA_DIR = $data

function Acorn {
  & $installed @args
  if ($LASTEXITCODE) { throw "acorn $args failed with exit code $LASTEXITCODE." }
}

# The user PATH can hold %VARIABLES%, which [Environment]::SetEnvironmentVariable would expand for good.
function Set-UserPath([scriptblock]$change) {
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
  $entries = @("$($key.GetValue('Path', '', 'DoNotExpandEnvironmentNames'))" -split ';' | Where-Object { $_ -and $_ -ne $bin })
  $key.SetValue('Path', ((& $change $entries) -join ';'), 'ExpandString')
  $key.Close()
  # Setting any user variable this way tells open programs, such as Explorer, to read the environment again.
  [Environment]::SetEnvironmentVariable('ACORN_INSTALL_REFRESH', $null, 'User')
}

# rmdir removes a junction without following it into the version it points at.
function Remove-Junction($path) { if (Test-Path $path) { cmd /c rmdir "$path" } }

if ($Uninstall) {
  if (Test-Path $installed) {
    & $installed node service uninstall | Out-Null
    & $installed node stop | Out-Null
  }
  Remove-Junction $current
  foreach ($path in 'versions', 'logs', 'bin', 'acorn-node-service.cmd') {
    $full = Join-Path $root $path
    if (Test-Path $full) { Remove-Item -Recurse -Force $full }
  }
  Set-UserPath { param($entries) $entries }
  "Removed acorn from $root."
  if ($Purge -and (Test-Path $data)) {
    $answer = Read-Host "To delete the Node's data, type its path, $data"
    if ($answer -eq $data) { Remove-Item -Recurse -Force $data; "Deleted $data." }
    else { "That didn't match, so the data stays." }
  }
  if (Test-Path $data) { "Kept the Node's data in $data." }
  "Kept the acorn command's device tokens in $(Join-Path $env:APPDATA 'acorn')."
  if (-not (Get-ChildItem $root -Force -ErrorAction SilentlyContinue)) { Remove-Item $root -ErrorAction SilentlyContinue }
  exit 0
}

$desktop = Join-Path $env:APPDATA 'com.acorn.desktop\node'
if ((Test-Path (Join-Path $desktop 'node.json')) -and -not $Force) {
  Fail "the acorn desktop app already runs a Node on this machine, with its data in $desktop. One machine runs one Node, so pair with the desktop's Node instead. Run install.ps1 -Force to install a second one anyway."
}

# Copy first, so a failure before the switch leaves the earlier version current and its Node running.
$versions = Join-Path $root 'versions'
$target = Join-Path $versions $version
$previous = if (Test-Path $current) { Split-Path -Leaf @((Get-Item $current).Target)[0] } else { '' }
New-Item -ItemType Directory -Force $versions | Out-Null
if ($here -ne $target) {
  if (Test-Path "$target.partial") { Remove-Item -Recurse -Force "$target.partial" }
  Copy-Item -Recurse $here "$target.partial"
  Get-ChildItem -Recurse -File "$target.partial" | Unblock-File
}

$stopped = $false
if (Test-Path $installed) {
  $status = & $installed node status --output json | ConvertFrom-Json
  if ($status.state -like 'running*') { Acorn node stop | Out-Null; $stopped = $true }
}

if ($here -ne $target) {
  if (Test-Path $target) { Remove-Item -Recurse -Force $target }
  Rename-Item "$target.partial" $version
}
Remove-Junction $current
New-Item -ItemType Junction -Path $current -Target $target | Out-Null
New-Item -ItemType Directory -Force $bin | Out-Null
# The shim finds the install from its own folder, so it holds no path a code page could garble.
Set-Content -Encoding Ascii $shim @(
  '@echo off',
  "rem Written by the acorn Node installer. Runs the installed acorn with the Node's data folder.",
  'setlocal',
  'if not defined ACORN_DATA_DIR for %%I in ("%~dp0..") do set "ACORN_DATA_DIR=%%~fI\node"',
  '"%~dp0..\current\bin\acorn.cmd" %*',
  'exit /b %ERRORLEVEL%'
)
Set-UserPath { param($entries) @($entries) + $bin }
New-Item -ItemType Directory -Force $data | Out-Null
# POSIX modes are advisory on Windows, so the data folder gets an access list: this user and SYSTEM only.
icacls $data /inheritance:r /grant:r "*$($identity.User.Value):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE) { Fail "icacls could not restrict $data to this user." }

$registered = (& $installed node service status --output json | ConvertFrom-Json).loaded
if ($stopped) {
  # Installing the service again starts the Node through it.
  if ($registered) { Acorn node service install | Out-Null } else { Acorn node start --background | Out-Null }
}
if (-not $registered) {
  $wanted = if ($Service) { $true } elseif ($NoService) { $false } elseif ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
    (Read-Host 'Start the Node when you sign in? [Y/n]') -notmatch '^[Nn]'
  } else { $false }
  if ($wanted) { Acorn node service install; $registered = $true }
}

Get-ChildItem $versions -Directory | Where-Object { $_.Name -ne $version -and $_.Name -ne $previous } | Remove-Item -Recurse -Force

''
"Installed acorn $version in $root, with the Node's data in $data."
'Next, in a new terminal:'
if (-not $registered -and -not $stopped) {
  '  acorn node start --background   start the Node now, or run install.ps1 -Service to start it at sign-in'
}
"  acorn node reach HOST           let other machines reach the Node at this computer's name or address"
'  acorn node pair                 print a pairing code for a client on another machine'
'  acorn agent providers           check that the Node finds claude or codex'
