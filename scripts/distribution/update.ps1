# `sentry update <archive.zip>`: install a release archive the user downloaded, safely.
# Nothing here downloads, follows a branch or checks for a new version: the user names the ZIP.
# Every step that can fail runs before anything changes; the running install is never modified.

# Compares two release versions (1.2.3 or 1.2.3-rc.1). Returns -1, 0 or 1; a release is newer than its own pre-release.
function Compare-SentryVersion {
  param([Parameter(Mandatory = $true)][string]$Left, [Parameter(Mandatory = $true)][string]$Right)
  $pattern = '^(\d+)\.(\d+)\.(\d+)(?:-([A-Za-z0-9.-]+))?$'
  $a = [regex]::Match($Left, $pattern); $b = [regex]::Match($Right, $pattern)
  if (-not $a.Success -or -not $b.Success) { throw 'Version is not in the form 1.2.3 or 1.2.3-rc.1' }
  foreach ($part in 1..3) {
    $x = [int]$a.Groups[$part].Value; $y = [int]$b.Groups[$part].Value
    if ($x -ne $y) { return $(if ($x -lt $y) { -1 } else { 1 }) }
  }
  $pre = $a.Groups[4].Value; $other = $b.Groups[4].Value
  if ($pre -eq $other) { return 0 }
  if ($pre -eq '') { return 1 }
  if ($other -eq '') { return -1 }
  # Both pre-releases: compare dot-separated identifiers, numbers numerically.
  $preParts = $pre -split '\.'; $otherParts = $other -split '\.'
  for ($i = 0; $i -lt [Math]::Min($preParts.Count, $otherParts.Count); $i++) {
    $l = $preParts[$i]; $r = $otherParts[$i]
    $ln = $l -match '^\d+$'; $rn = $r -match '^\d+$'
    if ($ln -and $rn) { if ([int64]$l -ne [int64]$r) { return $(if ([int64]$l -lt [int64]$r) { -1 } else { 1 }) } }
    elseif ($ln) { return -1 }
    elseif ($rn) { return 1 }
    elseif ($l -ne $r) { return $(if ([string]::CompareOrdinal($l, $r) -lt 0) { -1 } else { 1 }) }
  }
  if ($preParts.Count -eq $otherParts.Count) { return 0 }
  return $(if ($preParts.Count -lt $otherParts.Count) { -1 } else { 1 })
}

# The SHA256 the .sha256 file beside the ZIP promises, checked against the ZIP itself. Returns the hash.
function Confirm-SentryArchiveChecksum {
  param([Parameter(Mandatory = $true)][string]$Archive)
  $sidecar = $Archive + '.sha256'
  if (-not (Test-Path -LiteralPath $sidecar -PathType Leaf)) {
    throw ('The checksum file is missing. Download ' + [IO.Path]::GetFileName($sidecar) + ' next to the ZIP.')
  }
  $line = (Get-Content -LiteralPath $sidecar -TotalCount 1)
  $expected = ([string]$line -split '\s+')[0].ToLowerInvariant()
  if ($expected -notmatch '^[0-9a-f]{64}$') { throw 'The checksum file is not a SHA256 checksum.' }
  $actual = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw 'The ZIP does not match its checksum. It is damaged or was changed; download it again.' }
  return $actual
}

# Checks the GitHub build attestation (who built the ZIP) when the GitHub CLI is installed.
# Returns 'verified', or 'unchecked' with a warning when gh is missing; throws when gh says the ZIP is not ours.
function Confirm-SentryArchiveAttestation {
  param([Parameter(Mandatory = $true)][string]$Archive, [string]$Repository = 'Mert1026/Sentry')
  $gh = Get-Command gh -ErrorAction SilentlyContinue
  if ($null -eq $gh) {
    Write-Warning 'GitHub CLI (gh) is not installed, so only the checksum was checked: it proves the ZIP is not damaged, not who published it. Install gh to verify the publisher.'
    return 'unchecked'
  }
  & $gh.Source attestation verify $Archive --repo $Repository | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'GitHub does not vouch for this ZIP: its build attestation did not verify. Do not install it.' }
  return 'verified'
}

# Extracts the ZIP into its own new directory. Refuses entries that would land outside it.
function Expand-SentryArchive {
  param([Parameter(Mandatory = $true)][string]$Archive, [Parameter(Mandatory = $true)][string]$Destination)
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $full = [IO.Path]::GetFullPath($Destination).TrimEnd('\') + '\'
  $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
  try {
    foreach ($entry in $zip.Entries) {
      $target = [IO.Path]::GetFullPath((Join-Path $Destination $entry.FullName))
      if (-not $target.StartsWith($full, [StringComparison]::OrdinalIgnoreCase)) { throw 'The ZIP holds a path outside its own folder. Do not install it.' }
    }
  } finally { $zip.Dispose() }
  if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Recurse -Force }
  [void](New-Item -ItemType Directory -Force -Path $Destination)
  [IO.Compression.ZipFile]::ExtractToDirectory($Archive, $Destination)
  # A ZIP made by zipping a folder holds that folder; accept both shapes.
  if (-not (Test-Path -LiteralPath (Join-Path $Destination 'distribution.json'))) {
    $children = @(Get-ChildItem -LiteralPath $Destination -Directory)
    if ($children.Count -eq 1 -and (Test-Path -LiteralPath (Join-Path $children[0].FullName 'distribution.json'))) { return $children[0].FullName }
    throw 'The ZIP is not a Sentry release archive (no distribution.json).'
  }
  return $Destination
}

# Copies the Desktop profile and the Linux data (database, accounts, projects) into a timestamped folder.
# Tools and toolchains are not copied: setup installs them again.
function Backup-SentryData {
  param([Parameter(Mandatory = $true)][string]$Distro, [Parameter(Mandatory = $true)][string]$Folder)
  [void](New-Item -ItemType Directory -Force -Path $Folder)
  $profileDir = Join-Path $env:APPDATA '@qa\desktop'
  if (Test-Path -LiteralPath $profileDir) { Copy-Item -LiteralPath $profileDir -Destination (Join-Path $Folder 'desktop-profile') -Recurse -Force }
  $linux = Invoke-SentryWsl -Distro $Distro -LinuxArgs @('wslpath', '-u', ((Join-Path $Folder 'sentry-data.tar.gz').Replace('\', '/'))) -TimeoutSec 30
  if ($linux.ExitCode -ne 0 -or -not ([string]$linux.Stdout).Trim()) { throw 'Backup failed: WSL path translation failed. Nothing was changed.' }
  $script = 'root="${SENTRY_DATA_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/sentry}"; [ -d "$root" ] || exit 0; tar -czf "$1" --exclude=./toolchains --exclude=./tools -C "$root" .'
  $tar = Invoke-SentryWsl -Distro $Distro -LinuxArgs @('bash', '-lc', $script, 'backup', ([string]$linux.Stdout).Trim()) -TimeoutSec 1800
  if ($tar.ExitCode -ne 0) { throw 'Backup failed. Nothing was changed. ' + [string]$tar.Stderr }
}
