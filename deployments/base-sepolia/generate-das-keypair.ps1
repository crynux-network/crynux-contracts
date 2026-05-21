$ErrorActionPreference = "Stop"

$nitroNodeImage = "offchainlabs/nitro-node:v3.10.1-d7f07be"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$keyDir = Join-Path $scriptDir "keys"

if (-not (Test-Path -Path $keyDir)) {
    New-Item -ItemType Directory -Path $keyDir | Out-Null
}

docker run --rm -v "${keyDir}:/data/keys" --entrypoint anytrusttool $nitroNodeImage keygen --dir /data/keys

if ($LASTEXITCODE -ne 0) {
    throw "Failed to generate DAS key pair."
}

$publicKey = (Get-Content -Raw -Path (Join-Path $keyDir "das_bls.pub")).Trim()
$privateKey = (Get-Content -Raw -Path (Join-Path $keyDir "das_bls")).Trim()

Write-Host "DAS BLS public key:"
Write-Host $publicKey
Write-Host "DAS BLS private key:"
Write-Host $privateKey
