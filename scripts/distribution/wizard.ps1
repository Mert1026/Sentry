# wizard.ps1 — the steps behind the Windows setup wizard (SentrySetup.exe).
# The wizard runs one step at a time and shows each step's output lines as its progress text:
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

function Write-WizardLine {
  param([string]$Text)
  Write-Host $Text
  Add-Content -LiteralPath $log -Value ((Get-Date -Format 's') + ' [' + $Step + '] ' + $Text) -Encoding UTF8
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
  throw 'No WSL distro was chosen yet; run the Ubuntu step first.'
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
      if ($win11 -and $x64) { Write-WizardLine ('OK Windows 11 x64 (build ' + $os.BuildNumber + ')') }
      else { Write-WizardLine 'FAIL Sentry needs Windows 11 on a 64-bit Intel or AMD processor.'; $code = 11 }
      if (Test-WizardVirtualization) { Write-WizardLine 'OK Hardware virtualization is on' }
      else { Write-WizardLine 'FAIL Hardware virtualization is off. Turn on Intel VT-x or AMD-V (SVM) in the BIOS/UEFI settings, then run this setup again.'; $code = 11 }
      if (Test-SentryWslAvailable) {
        Write-WizardLine 'OK WSL is installed'
        $usable = @((Get-SentryDistroClass @(Get-SentryWslDistros)).Usable)
        if ($usable.Count -gt 0) { Write-WizardLine ('OK Linux distribution: ' + (($usable | ForEach-Object { $_.Name }) -join ', ')) }
        else { Write-WizardLine 'TODO Ubuntu will be installed' }
      } else {
        Write-WizardLine 'TODO WSL2 and Ubuntu will be installed (Windows asks for administrator approval and may need one restart)'
      }
      $drive = Get-PSDrive -Name ($env:LOCALAPPDATA.Substring(0, 1)) -ErrorAction SilentlyContinue
      if ($drive -and $drive.Free -lt 10GB) { Write-WizardLine ('WARN Only ' + [math]::Round($drive.Free / 1GB, 1) + ' GB free; Sentry and Ubuntu need about 10 GB.') }
      else { Write-WizardLine 'OK Enough free disk space' }
    }
    'wsl' {
      if (Test-SentryWslAvailable) { Write-WizardLine 'WSL is already installed.'; break }
      Write-WizardLine 'Installing WSL2 (Windows asks for administrator approval)...'
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
          Write-WizardLine 'The administrator prompt was cancelled. Nothing was changed.'
          $code = 10
          break
        }
        Write-WizardLine ('WSL installer finished (exit ' + $proc.ExitCode + ').')
        if (($proc.ExitCode -ne 0) -and ($proc.ExitCode -ne 3010)) { throw ('WSL could not be installed (exit ' + $proc.ExitCode + ').') }
      } finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
      # Turning WSL on for the first time needs a restart before a distribution can start.
      Write-WizardLine 'WSL2 is installed. Windows needs to restart; setup continues by itself after you sign in again.'
      $code = 75
    }
    'ubuntu' {
      if (-not (Test-SentryWslAvailable)) { Write-WizardLine 'WSL is not ready yet. Restart Windows, then setup continues.'; $code = 75; break }
      $usable = @((Get-SentryDistroClass @(Get-SentryWslDistros)).Usable)
      if ($usable.Count -eq 0) {
        Write-WizardLine 'Downloading and installing Ubuntu (a few minutes)...'
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
      if (-not $distro) { throw 'Ubuntu could not be installed. Check your internet connection and run this setup again.' }
      # Everything here runs as root: a fresh distro's own user would start Ubuntu's first-run prompt.
      $rootProbe = Invoke-SentryNative -FilePath 'wsl.exe' -Arguments @('-d', $distro, '-u', 'root', '--', 'true') -TimeoutSec 120
      if ($rootProbe.ExitCode -ne 0) {
        Write-WizardLine ([string]$rootProbe.Stdout + [string]$rootProbe.Stderr).Replace([string][char]0, '').Trim()
        Write-WizardLine ($distro + ' cannot start yet. Restart Windows, then setup continues.')
        $code = 75
        break
      }
      # A distro without its first normal account (UID 1000) never finished its first run: create
      # one. A distro that has one is left exactly as it is.
      $firstUser = Invoke-SentryNative -FilePath 'wsl.exe' -Arguments @('-d', $distro, '-u', 'root', '--', 'getent', 'passwd', '1000') -TimeoutSec 60
      if ($firstUser.ExitCode -ne 0) {
        $name = Get-WizardLinuxUserName $env:USERNAME
        Write-WizardLine ('Creating the Linux account "' + $name + '" in ' + $distro + '...')
        $made = Invoke-SentryWslFile -Distro $distro -ScriptName 'create-user.sh' -ScriptArgs @($name) -TimeoutSec 120 -AsRoot $true
        Write-WizardLine ([string]$made.Stdout).Trim()
        if ($made.ExitCode -ne 0) { throw ('The Linux account could not be created: ' + ([string]$made.Stderr).Trim()) }
        [void](Invoke-SentryNative -FilePath 'wsl.exe' -Arguments @('--terminate', $distro) -TimeoutSec 60)
        Start-Sleep -Seconds 3
      }
      Set-SentryLauncherConfig @{ selectedDistro = $distro }
      Write-WizardLine ('Linux distribution ready: ' + $distro)
    }
    'linux' {
      $distro = Get-WizardDistro
      Write-WizardLine ('Preparing ' + $distro + ': Node 22, pnpm, systemd, bubblewrap, socat...')
      $toolchain = Invoke-SentryToolchainPhase -Distro $distro -RepoRoot (Join-Path $root 'runtime-source') 6>&1 | ForEach-Object {
        if ($_ -is [bool]) { $_ } else { Write-WizardLine ([string]$_) }
      }
      if (-not (@($toolchain) -contains $true)) { throw 'The Linux tools could not be installed (see the lines above).' }
    }
    'core' {
      $distro = Get-WizardDistro
      Write-WizardLine 'Installing the Sentry runtime inside WSL (several minutes)...'
      $code = Invoke-WizardLauncher @('setup', '-Distro', $distro, '-NonInteractive')
    }
    'tools' {
      $distro = Get-WizardDistro
      Write-WizardLine 'Installing the agent tools (OpenCode, DeepSeek, Claude Code)...'
      $code = Invoke-WizardLauncher @('tools', '-Distro', $distro, '-NonInteractive')
    }
  }
} catch {
  Write-WizardLine ('ERROR ' + $_.Exception.Message)
  $code = 1
}
Write-WizardLine ('RESULT ' + $code)
exit $code
