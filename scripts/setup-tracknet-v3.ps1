[CmdletBinding()]
param(
    # Python 3.11 executable (or the Windows py launcher) used only to create a new venv.
    [string]$Python = 'py',
    [switch]$SkipInstall,
    [switch]$Convert,
    [string]$Video = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$appDir = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $appDir '.tracknet-v3'
$repoDir = Join-Path $runtimeDir 'repo'
$venvDir = Join-Path $runtimeDir '.venv'
$venvPython = Join-Path $venvDir 'Scripts/python.exe'
$requirements = Join-Path $PSScriptRoot 'requirements-tracknet-v3.txt'
$sourceUrl = 'https://github.com/qaz812345/TrackNetV3.git'
$sourceCommit = '6eda442ada1740573f200f836d93edc9a541ee86'

function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed with exit code $LASTEXITCODE"
    }
}

function Assert-PlainDirectory {
    param([string]$Path)
    if (Test-Path -LiteralPath $Path) {
        $item = Get-Item -LiteralPath $Path -Force
        if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "Expected an ordinary directory, not a file or link: $Path"
        }
    }
}

Assert-PlainDirectory $runtimeDir
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
$lockPath = Join-Path $runtimeDir 'setup.lock'
$setupLock = $null
try {
    # CreateNew prevents two copies of this setup script from mutating the runtime together.
    $setupLock = [IO.File]::Open($lockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    foreach ($directory in @($repoDir, $venvDir)) { Assert-PlainDirectory $directory }

    if (Test-Path -LiteralPath $repoDir) {
        $topLevel = @(Invoke-Checked 'git' @('-C', $repoDir, 'rev-parse', '--show-toplevel'))[-1]
        if ([IO.Path]::GetFullPath($topLevel) -ne [IO.Path]::GetFullPath($repoDir)) {
            throw "Existing repo directory is not a standalone checkout: $repoDir"
        }
        $head = @(Invoke-Checked 'git' @('-C', $repoDir, 'rev-parse', 'HEAD'))[-1]
        if ($head -ne $sourceCommit) {
            throw "Existing repository is at $head, expected $sourceCommit. No checkout or reset performed."
        }
        $origin = @(Invoke-Checked 'git' @('-C', $repoDir, 'remote', 'get-url', 'origin'))[-1]
        if ($origin.TrimEnd('/') -notin @($sourceUrl, $sourceUrl.Substring(0, $sourceUrl.Length - 4))) {
            throw "Existing repository has unexpected origin: $origin"
        }
        $changes = @(Invoke-Checked 'git' @('-C', $repoDir, 'status', '--porcelain', '--untracked-files=no'))
        if ($changes.Count -gt 0) { throw 'Existing repository has tracked changes; leaving it intact.' }
        Write-Host "Using existing repository at $sourceCommit"
    } else {
        Invoke-Checked 'git' @('clone', '--no-checkout', $sourceUrl, $repoDir)
        Invoke-Checked 'git' @('-C', $repoDir, 'checkout', '--detach', $sourceCommit)
    }

    if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
        if (Test-Path -LiteralPath $venvDir) {
            throw "Existing environment is incomplete; leaving it intact: $venvDir"
        }
        if ($SkipInstall) { throw '-SkipInstall requires an existing Python environment.' }
        $pythonArgs = @()
        if ([IO.Path]::GetFileNameWithoutExtension($Python) -eq 'py') { $pythonArgs += '-3.11' }
        Invoke-Checked $Python ($pythonArgs + @('-c', 'import sys; assert sys.version_info[:2] == (3, 11)'))
        Invoke-Checked $Python ($pythonArgs + @('-m', 'venv', $venvDir))
    }
    Invoke-Checked $venvPython @('-c', 'import sys; assert sys.version_info[:2] == (3, 11)')

    if ($SkipInstall) {
        Write-Host 'Skipping dependency installation as requested.'
    } else {
        # Compare package metadata first so repeat setup does not invoke pip unnecessarily.
        $checkRequirements = @'
import importlib.metadata as metadata
from pathlib import Path
import sys
missing = []
for line in Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    name, version = line.split("==", 1)
    try:
        installed = metadata.version(name)
    except metadata.PackageNotFoundError:
        installed = None
    if installed != version:
        missing.append(line)
print("Requirements already satisfied" if not missing else "Installing pinned requirements: " + ", ".join(missing))
sys.exit(bool(missing))
'@
        # Stdin avoids native -c quote mangling in Windows PowerShell 5.1.
        $checkRequirements | & $venvPython - $requirements
        if ($LASTEXITCODE -ne 0) {
            Invoke-Checked $venvPython @('-m', 'pip', 'install', '-r', $requirements)
        }
        Invoke-Checked $venvPython @('-m', 'pip', 'check')
    }

    Invoke-Checked $venvPython @(
        (Join-Path $PSScriptRoot 'prepare-tracknet-v3-checkpoints.py'),
        '--runtime-dir', $runtimeDir, '--download'
    )
    foreach ($name in @('openvino', 'data')) {
        $directory = Join-Path $runtimeDir $name
        Assert-PlainDirectory $directory
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }

    if ($Convert) {
        $exportScript = Join-Path $PSScriptRoot 'export-tracknet-v3.py'
        if (-not (Test-Path -LiteralPath $exportScript -PathType Leaf)) {
            throw 'Conversion requested, but scripts/export-tracknet-v3.py is not available yet.'
        }
        Push-Location $appDir
        try {
            $testVideo = if ($Video) { $Video } else { Join-Path $appDir 'public/tracknet_predict.mp4' }
            Invoke-Checked $venvPython @($exportScript, '--video', $testVideo)
        }
        finally { Pop-Location }
    }
    Write-Host 'TrackNet V3 setup complete. Conversion runs only with -Convert.'
} finally {
    if ($null -ne $setupLock) {
        $setupLock.Dispose()
        Remove-Item -LiteralPath $lockPath
    }
}
