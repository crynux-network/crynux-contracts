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
$configScript = Join-Path $scriptDir "generate-dac-keyset-config.ts"
$dockerConfigFileName = "dac-keyset-docker-config.json"
$dockerConfigFile = Join-Path $targetDir $dockerConfigFileName
$configFile = Join-Path $targetDir "config.json"
$utf8NoBom = New-Object System.Text.UTF8Encoding $false

$configString = npx tsx $configScript --network=$Network

if ($LASTEXITCODE -ne 0) {
    throw "Failed to prepare the DAC keyset config."
}

[System.IO.File]::WriteAllText($dockerConfigFile, $configString, $utf8NoBom)

try {
    $toolOutput = docker run --rm -v "${targetDir}:/data/config" --entrypoint anytrusttool $nitroNodeImage dumpkeyset --conf.file "/data/config/$dockerConfigFileName"

    if ($LASTEXITCODE -ne 0) {
        throw "Failed to generate the DAC keyset."
    }
} finally {
    Remove-Item -Force -Path $dockerConfigFile -ErrorAction SilentlyContinue
}

$keysetMatch = $toolOutput | Select-String -Pattern "^Keyset:\s+(0x[0-9a-fA-F]+)$"
$keysetHashMatch = $toolOutput | Select-String -Pattern "^KeysetHash:\s+(0x[0-9a-fA-F]+)$"

if ($null -eq $keysetMatch -or $null -eq $keysetHashMatch) {
    throw "Failed to parse the DAC keyset output."
}

$keyset = $keysetMatch.Matches[0].Groups[1].Value
$keysetHash = $keysetHashMatch.Matches[0].Groups[1].Value
$config = Get-Content -Raw -Path $configFile | ConvertFrom-Json

$config.generatedDacKeyset.keyset = $keyset
$config.generatedDacKeyset.keysetHash = $keysetHash

[System.IO.File]::WriteAllText($configFile, (($config | ConvertTo-Json -Depth 100) + "`n"), $utf8NoBom)

Write-Host "DAC keyset:"
Write-Host $keyset
Write-Host "DAC keyset hash:"
Write-Host $keysetHash
Write-Host "Updated config file:"
Write-Host $configFile
