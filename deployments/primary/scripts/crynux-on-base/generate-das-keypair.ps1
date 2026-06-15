param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("testnet", "mainnet")]
    [string]$Network
)

$ErrorActionPreference = "Stop"

$nitroNodeImage = "offchainlabs/nitro-node:v3.10.1-d7f07be"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$primaryDir = Resolve-Path (Join-Path $scriptDir "..\..")
$networkFolder = if ($Network -eq "testnet") { "testnet\crynux-on-base-sepolia" } else { "mainnet\crynux-on-base" }
$targetDir = Join-Path $primaryDir $networkFolder
$keyDir = Join-Path $targetDir "keys"
$configFile = Join-Path $targetDir "config.json"
$utf8NoBom = New-Object System.Text.UTF8Encoding $false

if (-not (Test-Path -Path $keyDir)) {
    New-Item -ItemType Directory -Path $keyDir | Out-Null
}

docker run --rm -v "${keyDir}:/data/keys" --entrypoint anytrusttool $nitroNodeImage keygen --dir /data/keys

if ($LASTEXITCODE -ne 0) {
    throw "Failed to generate the DAS key pair."
}

$publicKey = (Get-Content -Raw -Path (Join-Path $keyDir "das_bls.pub")).Trim()
$privateKey = (Get-Content -Raw -Path (Join-Path $keyDir "das_bls")).Trim()
$config = Get-Content -Raw -Path $configFile | ConvertFrom-Json
$dacBackends = @($config.dacKeyset.backends)

if ($dacBackends.Count -eq 0) {
    throw "config.json must define at least one DAC backend."
}

$dacBackends[0].pubkey = $publicKey
[System.IO.File]::WriteAllText($configFile, (($config | ConvertTo-Json -Depth 100) + "`n"), $utf8NoBom)

Write-Host "DAS BLS public key:"
Write-Host $publicKey
Write-Host "DAS BLS private key:"
Write-Host $privateKey
Write-Host "Updated config file:"
Write-Host $configFile
