# =====================================================================
# Cindy Task Secretary - one-click install for new machines
# Usage (after DSH web installed & started once):
#   powershell -ExecutionPolicy Bypass -File install-cindy.ps1
# Options:
#   -Source       plugin source dir (default: this script's dir)
#   -ProfileRoot  DSH profile dir (default: $env:USERPROFILE\.dsh\profiles\web)
# Copies the plugin package into the profile's node_modules and appends
# the cordis.patch.yml insert block. Restart DSH to load Cindy.
# =====================================================================
param(
  [string]$Source = $PSScriptRoot,
  [string]$ProfileRoot = "$env:USERPROFILE\.dsh\profiles\web"
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path (Join-Path $Source 'package.json'))) { throw "plugin source not found: $Source" }
if (-not (Test-Path (Join-Path $ProfileRoot 'cordis.yml'))) { throw "DSH profile not found (start web once first): $ProfileRoot" }

# package name MUST match package.json "name"
$pkgName = '@mrchenxiangyu/cindy-taskman'
# node_modules: prefer sibling shared dir (profiles\node_modules), else profile-local (profiles\web\node_modules)
$nm = Join-Path (Split-Path $ProfileRoot -Parent) 'node_modules'
if (-not (Test-Path $nm)) { $nm = Join-Path $ProfileRoot 'node_modules' }
if (-not (Test-Path $nm)) { throw "node_modules not found: $nm (install & start DSH once first)" }
$dest = Join-Path $nm $pkgName

# clean up legacy dir from the old package name (@cindy/taskman)
$oldDest = Join-Path $nm '@cindy\taskman'
if (Test-Path $oldDest) {
  Remove-Item $oldDest -Recurse -Force
  Write-Output "[migrate] removed legacy dir: $oldDest"
}

New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item (Join-Path $Source 'package.json') $dest -Force
Copy-Item (Join-Path $Source 'lib') (Join-Path $dest 'lib') -Recurse -Force
Write-Output "[1/2] plugin package installed to $dest"

$patch = Join-Path $ProfileRoot 'cordis.patch.yml'
$raw = [System.IO.File]::ReadAllText($patch)
$block = "# -- Cindy Task Secretary (@mrchenxiangyu/cindy-taskman) ------------------" + [Environment]::NewLine +
         "- insert:" + [Environment]::NewLine +
         "    - id: cindy" + [Environment]::NewLine +
         "      name: '@mrchenxiangyu/cindy-taskman'" + [Environment]::NewLine
if ($raw -match "^\s*\[\s*\]\s*$") {
  # empty patch file: replace whole content
  [System.IO.File]::WriteAllText($patch, $block, (New-Object System.Text.UTF8Encoding($true)))
  Write-Output "[2/2] patch written: $patch"
} elseif ($raw -match "name:\s*'@mrchenxiangyu/cindy-taskman'") {
  Write-Output "[2/2] patch already contains Cindy, skipped: $patch"
} else {
  [System.IO.File]::AppendAllText($patch, [Environment]::NewLine + $block, (New-Object System.Text.UTF8Encoding($true)))
  Write-Output "[2/2] patch appended: $patch"
}

Write-Output ''
Write-Output 'Restart DSH to apply (Ctrl+C then re-run dsh web).'
Write-Output 'Data migration: copy the old data dir (with .taskman/) to this machine,'
Write-Output 'then set the root dir via panel Settings / cindy_set_root / env CINDY_ROOT.'
Write-Output 'Task workspaces re-register automatically.'
