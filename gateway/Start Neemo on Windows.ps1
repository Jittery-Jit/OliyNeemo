$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host ""
Write-Host "========================================"
Write-Host "          Starting Neemo"
Write-Host "========================================"
Write-Host ""

$nodeReady = $false
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) {
  $nodeMajor = [int]((node -p "process.versions.node.split('.')[0]"))
  $nodeReady = $nodeMajor -ge 22
}

if (-not $nodeReady) {
  $nodeVersion = "v22.22.2"
  $nodeArchitecture = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
  $nodeArchive = "node-$nodeVersion-win-$nodeArchitecture.zip"
  $runtimeRoot = Join-Path $PSScriptRoot ".runtime"
  $nodeDirectory = Join-Path $runtimeRoot "node-$nodeVersion-win-$nodeArchitecture"

  if (-not (Test-Path (Join-Path $nodeDirectory "node.exe"))) {
    Write-Host "Preparing Neemo's private runtime. This only happens once..."
    New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
    $temporaryArchive = Join-Path ([System.IO.Path]::GetTempPath()) $nodeArchive
    Invoke-WebRequest "https://nodejs.org/dist/$nodeVersion/$nodeArchive" -OutFile $temporaryArchive
    $checksumList = Invoke-RestMethod "https://nodejs.org/dist/$nodeVersion/SHASUMS256.txt"
    $checksumLine = ($checksumList -split "`n" | Where-Object { $_ -match "\s$([regex]::Escape($nodeArchive))$" } | Select-Object -First 1)
    if (-not $checksumLine) {
      throw "Neemo could not verify the official Node.js download."
    }
    $expectedChecksum = ($checksumLine -split "\s+")[0].ToLowerInvariant()
    $actualChecksum = (Get-FileHash -Algorithm SHA256 $temporaryArchive).Hash.ToLowerInvariant()
    if ($actualChecksum -ne $expectedChecksum) {
      throw "The private runtime download did not pass its safety check."
    }
    Expand-Archive -Path $temporaryArchive -DestinationPath $runtimeRoot -Force
    Remove-Item $temporaryArchive
  }

  $env:Path = "$nodeDirectory;$env:Path"
}

$dependenciesReady = Test-Path "node_modules"
if ($dependenciesReady) {
  corepack pnpm list --prod --depth 0 *> $null
  $dependenciesReady = $LASTEXITCODE -eq 0
}
if (-not $dependenciesReady) {
  Write-Host "Finishing Neemo's first-time setup..."
  corepack pnpm install --prod
}

Write-Host ""
Write-Host "Paste the setup code from the Neemo Hubs page when asked."
corepack pnpm connect
