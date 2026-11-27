# uninstall.ps1 — what the setup wizard's uninstaller runs before it deletes the program folder.
#   -Mode plan   prints what may be removed (PLAN key=value lines); changes nothing
#   -Mode clean  stops Sentry, removes the `sentry` command when it points here, and, when asked:
#                -DeleteData    Sentry's data in WSL (~/.local/share/sentry) and in Windows
#                -RemoveDistro  the Ubuntu that Sentry setup installed (everything inside it)
#                -RemoveWsl     WSL itself, when Sentry setup installed it and no distro is left
# Ubuntu and WSL that the person already had are never removed: the wizard records what it
# installed (wizardInstalledDistro, wizardInstalledWsl) and only those can be removed here.
# Exit codes: 0 done, 10 the administrator prompt for removing WSL was cancelled, 1 something
# could not be removed (see the log).
param(
  [Parameter(Mandatory = $true)][ValidateSet('plan', 'clean')][string]$Mode,
  [switch]$DeleteData,
  [switch]$RemoveDistro,
  [switch]$RemoveWsl
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $root 'scripts/launcher/SentryLauncher.psm1') -Force -DisableNameChecking
. (Join-Path $root 'scripts/launcher/wsl-setup.ps1')
. (Join-Path $root 'scripts/distribution/maintenance.ps1')

$sentryHome = Join-Path $env:LOCALAPPDATA 'Sentry'
$logDir = Join-Path $sentryHome 'logs'
[void](New-Item -ItemType Directory -Force -Path $logDir)
$log = Join-Path $logDir 'uninstall.log'
function Write-UninstallLine {
  param([string]$Text)
  Write-Host $Text
  Add-Content -LiteralPath $log -Value ((Get-Date -Format 's') + ' [' + $Mode + '] ' + $Text) -Encoding UTF8
}

$config = Get-SentryLauncherConfig
$distros = @(Get-SentryWslDistros)
$selected = [string]$config['selectedDistro']
# Only a distro the wizard installed, and only while it still exists.
$ownDistro = [string]$config['wizardInstalledDistro']
if ($ownDistro -and -not @($distros | Where-Object { $_.Name -ceq $ownDistro }).Count) { $ownDistro = '' }
$ownWsl = [bool]$config['wizardInstalledWsl']
$otherDistros = @($distros | Where-Object { $_.Name -cne $ownDistro })
# Other Sentry versions still installed share the data and the `sentry` command.
$here = [IO.Path]::GetFullPath($root).TrimEnd('\')
$otherVersions = @(Get-ChildItem -Path (Join-Path $sentryHome 'distributions\*\*') -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName.TrimEnd('\') -ine $here -and (Test-Path -LiteralPath (Join-Path $_.FullName 'sentry.ps1')) })

if ($Mode -eq 'plan') {
  Write-UninstallLine ('PLAN distro=' + $selected)
  Write-UninstallLine ('PLAN ownDistro=' + $ownDistro)
  Write-UninstallLine ('PLAN ownWsl=' + [int]$ownWsl)
  Write-UninstallLine ('PLAN otherDistros=' + $otherDistros.Count)
  Write-UninstallLine ('PLAN otherVersions=' + $otherVersions.Count)
  exit 0
}

$code = 0
function Invoke-UninstallStep {
  param([string]$Name, [scriptblock]$Action)
  try { & $Action; Write-UninstallLine ('DONE ' + $Name) }
  catch { Write-UninstallLine ('FAILED ' + $Name + ': ' + $_.Exception.Message); if ($script:code -eq 0) { $script:code = 1 } }
}

Invoke-UninstallStep 'stop' {
  $exe = Join-Path $root 'desktop\Sentry.exe'
  try { Stop-DistributionDesktop -Executable $exe }
  catch {
    # A run that does not stop in time must not block uninstalling: end this install's processes.
    Get-CimInstance Win32_Process | Where-Object { $_.Name -ieq 'Sentry.exe' -and ([string]$_.ExecutablePath).StartsWith($here + '\', [StringComparison]::OrdinalIgnoreCase) } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  }
}

Invoke-UninstallStep 'command' {
  $bin = Join-Path $sentryHome 'bin'
  $registration = Join-Path $bin 'release-command.json'
  if (-not (Test-Path -LiteralPath $registration)) { return }
  $target = [string]((Get-Content -LiteralPath $registration -Raw | ConvertFrom-Json).launcherPath)
  # Only the command that starts THIS install; another version or a source checkout keeps its own.
  if (-not $target.StartsWith($here + '\', [StringComparison]::OrdinalIgnoreCase)) { return }
  foreach ($file in @('sentry.cmd', 'sentry-launch.ps1', 'release-command.json')) {
    Remove-Item -LiteralPath (Join-Path $bin $file) -Force -ErrorAction SilentlyContinue
  }
  if (-not @(Get-ChildItem -LiteralPath $bin -Force -ErrorAction SilentlyContinue).Count) { Remove-Item -LiteralPath $bin -Force -ErrorAction SilentlyContinue }
  $userPath = [string][Environment]::GetEnvironmentVariable('Path', 'User')
  $kept = @($userPath -split ';' | Where-Object { $_.Trim() -ne '' -and $_.Trim().Trim('"').TrimEnd('\') -ine $bin.TrimEnd('\') })
  if ($kept.Count -ne @($userPath -split ';' | Where-Object { $_.Trim() -ne '' }).Count) {
    [Environment]::SetEnvironmentVariable('Path', ($kept -join ';'), 'User')
  }
}

Invoke-UninstallStep 'resume' {
  Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce' -Name 'SentrySetupResume' -ErrorAction SilentlyContinue
  if ($otherVersions.Count -eq 0) { Remove-Item -LiteralPath (Join-Path $sentryHome 'installer') -Recurse -Force -ErrorAction SilentlyContinue }
}

if ($DeleteData) {
  Invoke-UninstallStep 'data-wsl' {
    if (-not $selected -or -not @($distros | Where-Object { $_.Name -ceq $selected }).Count) { return }
    if ($RemoveDistro -and ($selected -ceq $ownDistro)) { return } # removed whole below
    # No shell: read the Linux home, check it, then remove exactly <home>/.local/share/sentry.
    $h = Invoke-SentryNative -FilePath 'wsl.exe' -Arguments @('-d', $selected, '--exec', 'printenv', 'HOME') -TimeoutSec 60
    $linuxHome = ([string]$h.Stdout).Replace([string][char]0, '').Trim()
    if (($h.ExitCode -ne 0) -or ($linuxHome -notmatch '^/[A-Za-z0-9._/-]*[A-Za-z0-9._-]$') -or ($linuxHome -match '(^|/)\.\.?(/|$)')) {
      throw ('unexpected Linux home: ' + $linuxHome)
    }
    $r = Invoke-SentryNative -FilePath 'wsl.exe' -Arguments @('-d', $selected, '--exec', 'rm', '-rf', '--', ($linuxHome + '/.local/share/sentry')) -TimeoutSec 600
    if ($r.ExitCode -ne 0) { throw ('rm exit ' + $r.ExitCode + ' ' + [string]$r.Stderr) }
  }
  Invoke-UninstallStep 'data-windows' {
    Remove-Item -LiteralPath (Join-Path $env:APPDATA '@qa\desktop') -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $sentryHome 'launcher') -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if ($RemoveDistro -and $ownDistro) {
  Invoke-UninstallStep 'distro' {
    $r = Invoke-SentryNative -FilePath 'wsl.exe' -Arguments @('--unregister', $ownDistro) -TimeoutSec 600
    if ($r.ExitCode -ne 0) { throw ('wsl --unregister exit ' + $r.ExitCode) }
  }
}

if ($RemoveWsl -and $ownWsl -and @(Get-SentryWslDistros).Count -eq 0) {
  Invoke-UninstallStep 'wsl' {
    try {
      $proc = Start-Process powershell.exe -ArgumentList '-NoProfile -WindowStyle Hidden -Command "wsl.exe --uninstall; exit $LASTEXITCODE"' -Verb RunAs -Wait -PassThru -ErrorAction Stop
    } catch {
      $script:code = 10
      throw 'administrator prompt cancelled'
    }
    if (($proc.ExitCode -ne 0) -and ($proc.ExitCode -ne 3010)) { throw ('wsl --uninstall exit ' + $proc.ExitCode) }
  }
}

if ($DeleteData -and $code -eq 0) {
  # Last, and only when everything worked, so a failure keeps its log.
  Remove-Item -LiteralPath $logDir -Recurse -Force -ErrorAction SilentlyContinue
}
exit $code
