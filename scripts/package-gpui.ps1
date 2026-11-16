param(
    [ValidateNotNullOrEmpty()]
    [ValidateSet('x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc')]
    [string[]] $Targets = @('x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc'),
    [string] $OutputDirectory,
    [string] $DownloadBaseUrl,
    [string] $NotesFile,
    [string] $SigningKey,
    [string] $Minisign = 'minisign',
    [string] $Makensis = 'makensis',
    [string] $SigningPasswordEnvironment,
    [switch] $Unsigned
)
$ErrorActionPreference = 'Stop'
$repository = Split-Path $PSScriptRoot -Parent
$desktop = Join-Path $repository 'desktop'
$buildDirectory = if ($env:CARGO_TARGET_DIR) { [IO.Path]::GetFullPath($env:CARGO_TARGET_DIR, $desktop) } else { Join-Path $desktop 'target' }
if (!$OutputDirectory) { $OutputDirectory = Join-Path $desktop 'target/gpui-release' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
if (Test-Path -LiteralPath (Join-Path $OutputDirectory 'gpui-latest.json')) { throw 'Use a fresh output directory; an existing update manifest must not be overwritten' }
$config = [IO.File]::ReadAllText((Join-Path $desktop 'updater/config.json')) | ConvertFrom-Json
$manifestText = [IO.File]::ReadAllText((Join-Path $desktop 'patina/Cargo.toml'))
$version = [regex]::Match($manifestText, '(?m)^version\s*=\s*"([^"]+)"').Groups[1].Value
if ($version -notmatch '^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$') { throw 'Unsupported GPUI version' }
$resourceVersion = "$($Matches[1]).$($Matches[2]).$($Matches[3]).0"
if (!$Unsigned) {
    if (!$SigningKey -or !(Test-Path -LiteralPath $SigningKey -PathType Leaf)) { throw 'A minisign secret key file is required for signed packages' }
    $SigningKey = [IO.Path]::GetFullPath($SigningKey)
    $baseUri = [Uri] $DownloadBaseUrl
    if (!$baseUri.IsAbsoluteUri -or $baseUri.Scheme -ne 'https' -or $baseUri.UserInfo -or $baseUri.Query -or $baseUri.Fragment) { throw 'DownloadBaseUrl must be an HTTPS directory URL without credentials, query or fragment' }
    $Minisign = (Get-Command $Minisign -CommandType Application -ErrorAction Stop).Source
}
$Makensis = (Get-Command $Makensis -CommandType Application -ErrorAction Stop).Source
$notes = if ($NotesFile) { [IO.File]::ReadAllText([IO.Path]::GetFullPath($NotesFile)) } else { '' }
$platforms = [ordered]@{}
Push-Location $desktop
try {
    foreach ($target in ($Targets | Select-Object -Unique)) {
        & cargo build --locked --release -p patina-gpui --target $target
        if ($LASTEXITCODE -ne 0) { throw "GPUI build failed: $target" }
        $architecture = if ($target.StartsWith('x86_64')) { 'x64' } else { 'arm64' }
        $platform = if ($architecture -eq 'x64') { 'windows-x86_64' } else { 'windows-aarch64' }
        $name = "Patina_${version}_${architecture}-setup.exe"
        $installer = Join-Path $OutputDirectory $name
        if (Test-Path -LiteralPath $installer) { throw "Package already exists: $name" }
        $binary = Join-Path $buildDirectory "$target/release/patina-gpui.exe"
        & $Makensis '/V2' "/DAPP_VERSION=$version" "/DRESOURCE_VERSION=$resourceVersion" "/DAPP_BINARY=$binary" "/DOUTPUT_FILE=$installer" (Join-Path $desktop 'installer/patina.nsi')
        if ($LASTEXITCODE -ne 0) { throw "NSIS packaging failed: $target" }
        if (!$Unsigned) {
            $signatureFile = "$installer.minisig"
            if ($SigningPasswordEnvironment) {
                $password = [string][Environment]::GetEnvironmentVariable($SigningPasswordEnvironment)
                if ($password -match '[\r\n]') { throw 'Signing password must be a single line' }
                $password | & $Minisign -S -s $SigningKey -m $installer -x $signatureFile -t "$($config.application) $version $platform"
            } else {
                & $Minisign -S -s $SigningKey -m $installer -x $signatureFile -t "$($config.application) $version $platform"
            }
            if ($LASTEXITCODE -ne 0) { throw 'Installer signing failed' }
            $publicText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($config.public_key))
            $publicKey = ($publicText -split '\r?\n')[1]
            & $Minisign -V -P $publicKey -m $installer -x $signatureFile
            if ($LASTEXITCODE -ne 0) { throw 'Installer signature does not match the application public key' }
            $platforms[$platform] = [ordered]@{
                url = "$($DownloadBaseUrl.TrimEnd('/'))/$name"
                signature = [Convert]::ToBase64String([IO.File]::ReadAllBytes($signatureFile))
                size = (Get-Item -LiteralPath $installer).Length
            }
        }
    }
    if (!$Unsigned) {
        $manifest = [ordered]@{ schema = 1; application = $config.application; version = $version; notes = $notes; platforms = $platforms }
        $json = ConvertTo-Json -InputObject $manifest -Depth 6
        if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 1048576) { throw 'Update manifest exceeds 1 MiB' }
        [IO.File]::WriteAllText((Join-Path $OutputDirectory 'gpui-latest.json'), "$json`n", [Text.UTF8Encoding]::new($false))
    }
} finally {
    Pop-Location
}
Write-Output "Patina packages: $OutputDirectory"
