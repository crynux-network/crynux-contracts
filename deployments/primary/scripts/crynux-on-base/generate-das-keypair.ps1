param([Parameter(Mandatory = $true)][ValidateSet("testnet", "mainnet")][string]$Network)

& (Join-Path $PSScriptRoot "..\lib\orbit\generate-das-keypair.ps1") `
    -Network $Network `
    -TestnetLayerFolder "crynux-on-base-sepolia" `
    -MainnetLayerFolder "crynux-on-base"
