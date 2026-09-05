param(
  [Parameter(Mandatory)][string]$Target,
  [Parameter(Mandatory)][ValidateSet('windows-x86_64', 'windows-aarch64')][string]$Platform
)

$ErrorActionPreference = 'Stop'
# Production installer behavior is exercised only on disposable hosted runners.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'Installer verification requires a disposable GitHub-hosted runner.'
}
if ($Target -notin @('x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc')) { throw 'Unsupported target' }
$bundleRoot = Join-Path (Get-Location) "src-tauri/target/$Target/release"
$installers = @(Get-ChildItem -LiteralPath (Join-Path $bundleRoot 'bundle/nsis') -Filter '*.exe')
if ($installers.Count -ne 1) { throw 'Expected exactly one NSIS installer' }
$testRoot = Join-Path $env:RUNNER_TEMP ('patina-install-' + [guid]::NewGuid().ToString('N'))
$installRoot = Join-Path $testRoot 'app'
$dataRoot = Join-Path $env:APPDATA 'Patina'
if (Test-Path -LiteralPath $dataRoot) { throw 'Refusing to use pre-existing production data' }
$appProcess = $null

function Invoke-BoundedInstaller([string]$Executable, [string]$Arguments) {
  $installerProcess = Start-Process -FilePath $Executable -ArgumentList $Arguments -PassThru -WindowStyle Hidden
  if (-not $installerProcess.WaitForExit(180000)) {
    Stop-Process -Id $installerProcess.Id -Force -ErrorAction SilentlyContinue
    throw "Installer timed out: $Executable"
  }
  if ($installerProcess.ExitCode -ne 0) { throw "Installer exit code: $($installerProcess.ExitCode)" }
}

try {
  New-Item -ItemType Directory -Path $testRoot | Out-Null
  Invoke-BoundedInstaller $installers[0].FullName "/S /D=$installRoot"
  $installedExe = Join-Path $installRoot 'Patina.exe'
  if (-not (Test-Path -LiteralPath $installedExe)) { throw 'Installed executable missing' }
  # Tauri patches the bundled executable's package-type marker before NSIS compression.
  $installedDigest = (Get-FileHash $installedExe).Hash
  node --experimental-strip-types --input-type=module -e "import { readFileSync } from 'node:fs'; import { verifyPeArchitecture } from './scripts/release.ts'; verifyPeArchitecture(readFileSync(process.argv[1]), process.argv[2]);" $installedExe $Platform
  if ($LASTEXITCODE -ne 0) { throw 'Installed architecture mismatch' }

  $appProcess = Start-Process -FilePath $installedExe -PassThru -WindowStyle Hidden
  $dbPath = Join-Path $dataRoot 'patina.db'
  $deadline = [DateTime]::UtcNow.AddSeconds(90)
  do {
    $appProcess.Refresh()
    if ($appProcess.HasExited) { throw "Installed application exited: $($appProcess.ExitCode)" }
    if ((Test-Path -LiteralPath $dbPath) -and $appProcess.MainWindowHandle -ne 0) { break }
    # Poll observable database and window readiness; the deadline bounds startup.
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $deadline)
  if (-not (Test-Path -LiteralPath $dbPath) -or $appProcess.MainWindowHandle -eq 0) {
    throw 'Installed application did not initialize its database and main window'
  }
  Stop-Process -Id $appProcess.Id -Force
  $appProcess.WaitForExit()
  $appProcess = $null
  $databaseDigest = (Get-FileHash $dbPath).Hash

  # Reinstall exercises NSIS replacement without changing the app data identity.
  Invoke-BoundedInstaller $installers[0].FullName "/S /D=$installRoot"
  if ((Get-FileHash $dbPath).Hash -ne $databaseDigest) { throw 'Installer modified existing database bytes' }
  if ((Get-FileHash $installedExe).Hash -ne $installedDigest) {
    throw 'Reinstalled executable differs from the first installation'
  }
  $uninstallers = @(Get-ChildItem -LiteralPath $installRoot -Filter '*uninstall*.exe')
  if ($uninstallers.Count -ne 1) { throw 'Expected exactly one uninstaller' }
  Invoke-BoundedInstaller $uninstallers[0].FullName "/S _?=$installRoot"
  if (Test-Path -LiteralPath $installedExe) { throw 'Uninstall left the application executable behind' }
  if (-not (Test-Path -LiteralPath $dbPath) -or (Get-FileHash $dbPath).Hash -ne $databaseDigest) {
    throw 'Silent uninstall changed retained user data'
  }
  Write-Host "Installer lifecycle passed: $Platform"
} finally {
  if ($appProcess -and -not $appProcess.HasExited) { Stop-Process -Id $appProcess.Id -Force }
  $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
  $allowedRoot = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\') + '\'
  if (-not $resolvedTestRoot.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe cleanup path' }
  if (Test-Path -LiteralPath $resolvedTestRoot) { Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force }
  # The hosted VM owns remaining application data and shell registration cleanup.
}
