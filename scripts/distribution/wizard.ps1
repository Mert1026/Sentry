# wizard.ps1 — the steps behind the Windows setup wizard (SentrySetup.exe).
# The wizard runs one step at a time. Lines meant for the person are codes the wizard translates
# (English or Bulgarian): `MSG <Code>|<arg>...` is the current status and `FAIL <Code>|<arg>...`
# a problem to report. Every other line is technical output that only goes to the log.
#   check   Windows 11 x64, virtualization, WSL and distro state (changes nothing)
#   wsl     install WSL2 itself (the only step that asks for administrator approval)
#   ubuntu  install Ubuntu when no WSL2 distro is usable and create its Linux account
#   linux   Linux Node 22, pnpm, systemd, bubblewrap and socat (as root inside WSL, no sudo prompt)
#   core    the archive's own `sentry.ps1 setup`
#   tools   the archive's own `sentry.ps1 tools`
# Exit codes: 0 done, 75 restart Windows first, 10 cancelled at the administrator prompt,
# 11 this PC cannot run Sentry (the wizard says why), anything else failed (see the log).
param(
  [Parameter(Mandatory = $true)][ValidateSet('check', 'wsl', 'ubuntu', 'linux', 'core', 'tools')][string]$Step
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $root 'scripts/launcher/SentryLauncher.psm1') -Force -DisableNameChecking
. (Join-Path $root 'scripts/launcher/prerequisites.ps1')
. (Join-Path $root 'scripts/launcher/wsl-setup.ps1')

$logDir = Join-Path $env:LOCALAPPDATA 'Sentry\logs'
[void](New-Item -ItemType Directory -Force -Path $logDir)
$log = Join-Path $logDir 'setup-wizard.log'

function Write-WizardOut {
  param([string]$Text)
  Write-Host $Text
  Add-Content -LiteralPath $log -Value ((Get-Date -Format 's') + ' [' + $Step + '] ' + $Text) -Encoding UTF8
}

# Technical output: indented, so it can never be read as a MSG/FAIL code.
function Write-WizardLine {
  param([string]$Text)
  foreach ($line in (([string]$Text) -split '\r?\n')) { if ($line.Trim()) { Write-WizardOut ('  ' + $line.TrimEnd()) } }
}

# A status the wizard shows in the person's language (see the W_ messages in sentry-setup.iss).
function Write-WizardMessage {
  param([string]$Code, [string[]]$Arguments = @())
  Write-WizardOut ('MSG ' + ((@($Code) + $Arguments) -join '|'))
}

# A problem the wizard reports in the person's language.
function Write-WizardProblem {
  param([string]$Code, [string[]]$Arguments = @())
  Write-WizardOut ('FAIL ' + ((@($Code) + $Arguments) -join '|'))
}

# Reports a problem and ends the step as failed.
function Stop-Wizard {
  param([string]$Code, [string[]]$Arguments = @())
  Write-WizardProblem $Code $Arguments
  throw [System.OperationCanceledException]::new('wizard-stop')
}

# The Linux account name: the Windows user name in the form Linux accepts, or "sentry".
function Get-WizardLinuxUserName {
  param([string]$WindowsName)
  $name = ([string]$WindowsName).ToLowerInvariant() -replace '[^a-z0-9_-]', ''
  if ($name -notmatch '^[a-z_]') { $name = '' }
  if ($name.Length -gt 31) { $name = $name.Substring(0, 31) }
  if ($name -in @('', 'root', 'admin', 'administrator', 'daemon', 'nobody', 'sys', 'bin', 'sync', 'sudo', 'ubuntu')) { return 'sentry' }
  return $name
}

function Test-WizardVirtualization {
  try {
    if ((Get-CimInstance Win32_ComputerSystem).HypervisorPresent) { return $true }
    # Reads false while a hypervisor already runs, which the check above covers.
    return [bool]((Get-CimInstance Win32_Processor | Select-Object -First 1).VirtualizationFirmwareEnabled)
  } catch { return $true }
}

function Get-WizardDistro {
  $cfg = Get-SentryLauncherConfig
  $selected = [string]$cfg['selectedDistro']
  if ($selected) { return $selected }
  Stop-Wizard 'NoDistro'
}

# Runs the archive's own launcher and streams its output into the wizard.
function Invoke-WizardLauncher {
  param([string[]]$LauncherArguments)
  $all = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $root 'sentry.ps1')) + $LauncherArguments
  & powershell.exe @all 2>&1 | ForEach-Object { Write-WizardLine ([string]$_) }
  return $LASTEXITCODE
}

$code = 0
try {
  switch ($Step) {
    'check' {
      $os = Get-CimInstance Win32_OperatingSystem
      $win11 = ([int]$os.BuildNumber -ge 22000) -and ($os.ProductType -eq 1)
      $x64 = [Environment]::Is64BitOperatingSystem -and ($env:PROCESSOR_ARCHITECTURE -eq 'AMD64')
      if ($win11 -and $x64) { Write-WizardMessage 'CheckWindowsOk' @([string]$os.BuildNumber) }
      else { Write-WizardProblem 'CheckWindowsFail'; $code = 11 }
      if (Test-WizardVirtualization) { Write-WizardMessage 'CheckVirtOk' }
      else { Write-WizardProblem 'CheckVirtFail'; $code = 11 }
      $drive = Get-PSDrive -Name ($env:LOCALAPPDATA.Substring(0, 1)) -ErrorAction SilentlyContinue
      if ($drive -and $drive.Free -lt 10GB) { Write-WizardMessage 'CheckDiskLow' @([string][math]::Round($drive.Free / 1GB, 1)) }
      if (Test-SentryWslAvailable) {
        $usable = @((Get-SentryDistroClass @(Get-SentryWslDistros)).Usable)
        if ($usable.Count -gt 0) { Write-WizardMessage 'CheckDistroOk' @((($usable | ForEach-Object { $_.Name }) -join ', ')) }
        else { Write-WizardMessage 'CheckUbuntuTodo' }
      } else {
        Write-WizardMessage 'CheckWslTodo'
      }
    }
    'wsl' {
      if (Test-SentryWslAvailable) { Write-WizardMessage 'WslPresent'; break }
      Write-WizardMessage 'WslInstalling'
      $tmp = Join-Path ([IO.Path]::GetTempPath()) ('sentry-wsl-' + [guid]::NewGuid().ToString('N') + '.ps1')
      # Newer WSL installs without a distribution (Ubuntu follows in its own step, without its
      # first-run prompt); older inbox WSL only knows the plain form.
      $elevated = @(
        'wsl.exe --install --no-distribution',
        'if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 3010) { wsl.exe --install -d Ubuntu --no-launch }',
        'if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 3010) { wsl.exe --install }',
        'exit $LASTEXITCODE'
      ) -join [Environment]::NewLine
      [IO.File]::WriteAllText($tmp, $elevated, (New-Object Text.UTF8Encoding $false))
      try {
        try {
          $proc = Start-Process powershell.exe -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $tmp + '"') -Verb RunAs -Wait -PassThru -ErrorAction Stop
        } catch {
          Write-WizardLine 'administrator prompt cancelled; nothing was changed'
          $code = 10
          break
        }
        Write-WizardLine ('WSL installer exit=' + $proc.ExitCode)
        if (($proc.ExitCode -ne 0) -and ($proc.ExitCode -ne 3010)) { Stop-Wizard 'WslFailed' @([string]$proc.ExitCode) }
      } finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
      # Remembered so the uninstaller may offer to remove WSL again; never offered for a WSL the
      # person already had.
      Set-SentryLauncherConfig @{ wizardInstalledWsl = $true }
      # Turning WSL on for the first time needs a restart before a distribution can start.
      Write-WizardMessage 'WslRestart'
      $code = 75
    }
    'ubuntu' {
      if (-not (Test-SentryWslAvailable)) { Write-WizardMessage 'WslRestart'; $code = 75; break }
      $usable = @((Get-SentryDistroClass @(Get-SentryWslDistros)).Usable)
      if ($usable.Count -eq 0) {
        Write-WizardMessage 'UbuntuInstalling'
        # Remembered so the uninstaller may offer to remove this Ubuntu again; a distro the person
        # already had is never offered.
        Set-SentryLauncherConfig @{ wizardInstalledDistro = 'Ubuntu' }
        $r = Invoke-SentryNative -FilePath 'wsl.exe' -Arguments @('--install', '-d', 'Ubuntu', '--no-launch') -TimeoutSec 1800
        Write-WizardLine ('wsl --install -d Ubuntu exit=' + $r.ExitCode)
        # Store-packaged Ubuntu registers only after its own installer runs once.
        $ubuntuExe = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\ubuntu.exe'
        if (-not @(Get-SentryWslDistros | Where-Object { $_.Name -ieq 'Ubuntu' }).Count -and (Test-Path -LiteralPath $ubuntuExe)) {
          $r = Invoke-SentryNative -FilePath $ubuntuExe -Arguments @('install', '--root') -TimeoutSec 1800
          Write-WizardLine ('ubuntu install exit=' + $r.ExitCode)
        }
      }
      $prev = [string](Get-SentryLauncherConfig)['selectedDistro']
      $distro = Select-SentryDistro -Distros @(Get-SentryWslDistros) -Previous $prev -Explicit '' -NonInteractive $true
      if (-not $distro) { Stop-Wizard 'UbuntuFailed' }
      # Everything here runs as root: a fresh distro's own user would start Ubuntu's first-run prompt.
      $rootProbe = Invoke-SentryNative -FilePath 'wsl.exe' -Arguments @('-d', $distro, '-u', 'root', '--', 'true') -TimeoutSec 120
      if ($rootProbe.ExitCode -ne 0) {
        Write-WizardLine ([string]$rootProbe.Stdout + [string]$rootProbe.Stderr).Replace([string][char]0, '').Trim()
        Write-WizardMessage 'DistroRestart' @($distro)
        $code = 75
        break
      }
      # A distro without its first normal account (UID 1000) never finished its first run: create
      # one. A distro that has one is left exactly as it is.
      $firstUser = Invoke-SentryNative -FilePath 'wsl.exe' -Arguments @('-d', $distro, '-u', 'root', '--', 'getent', 'passwd', '1000') -TimeoutSec 60
      if ($firstUser.ExitCode -ne 0) {
        $name = Get-WizardLinuxUserName $env:USERNAME
        Write-WizardMessage 'AccountCreating' @($name, $distro)
        $made = Invoke-SentryWslFile -Distro $distro -ScriptName 'create-user.sh' -ScriptArgs @($name) -TimeoutSec 120 -AsRoot $true
        Write-WizardLine ([string]$made.Stdout + [string]$made.Stderr).Trim()
        if ($made.ExitCode -ne 0) { Stop-Wizard 'AccountFailed' @($distro) }
        [void](Invoke-SentryNative -FilePath 'wsl.exe' -Arguments @('--terminate', $distro) -TimeoutSec 60)
        Start-Sleep -Seconds 3
      }
      Set-SentryLauncherConfig @{ selectedDistro = $distro }
      Write-WizardMessage 'DistroReady' @($distro)
    }
    'linux' {
      $distro = Get-WizardDistro
      Write-WizardMessage 'LinuxPreparing' @($distro)
      $toolchain = Invoke-SentryToolchainPhase -Distro $distro -RepoRoot (Join-Path $root 'runtime-source') 6>&1 | ForEach-Object {
        if ($_ -is [bool]) { $_ } else { Write-WizardLine ([string]$_) }
      }
      if (-not (@($toolchain) -contains $true)) { Stop-Wizard 'LinuxFailed' @($distro) }
    }
    'core' {
      $distro = Get-WizardDistro
      Write-WizardMessage 'CoreInstalling'
      $code = Invoke-WizardLauncher @('setup', '-Distro', $distro, '-NonInteractive')
      if ($code -ne 0) { Write-WizardProblem 'CoreFailed' }
    }
    'tools' {
      $distro = Get-WizardDistro
      Write-WizardMessage 'ToolsInstalling'
      $code = Invoke-WizardLauncher @('tools', '-Distro', $distro, '-NonInteractive')
      if ($code -ne 0) { Write-WizardProblem 'ToolsFailed' }
    }
  }
} catch {
  if ($_.Exception.Message -ne 'wizard-stop') {
    Write-WizardLine ('ERROR ' + $_.Exception.Message)
    Write-WizardProblem 'Unexpected'
  }
  $code = 1
}
Write-WizardOut ('RESULT ' + $code)
exit $code
