$ErrorActionPreference = 'Stop'
$installer = Join-Path $env:RUNNER_TEMP 'nsis-3.11-setup.exe'
curl.exe --fail --silent --show-error --location --retry 3 --output $installer 'https://downloads.sourceforge.net/project/nsis/NSIS%203/3.11/nsis-3.11-setup.exe'
if ($LASTEXITCODE -ne 0) { throw 'NSIS download failed' }
if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash -ne '38D49F8FE09B1C332B01D0940E57B7258F4447733643273A01C59959AD9D3B0A') { throw 'NSIS installer hash mismatch' }

$setup = Start-Process -FilePath $installer -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
if ($setup.ExitCode -ne 0) { throw "NSIS installation failed ($($setup.ExitCode))" }
$version = & "${env:ProgramFiles(x86)}/NSIS/makensis.exe" /VERSION
if ($LASTEXITCODE -ne 0 -or $version -cne 'v3.11') { throw "Unexpected NSIS version: $version" }
