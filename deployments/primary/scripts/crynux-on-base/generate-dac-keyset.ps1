param([Parameter(Mandatory = $true)][ValidateSet("testnet", "mainnet")][string]$Network)

& (Join-Path $PSScriptRoot "..\lib\orbit\generate-dac-keyset.ps1") `
    -Network $Network `
    -TestnetLayerFolder "crynux-on-base-sepolia" `
    -MainnetLayerFolder "crynux-on-base" `
    -CommandDirectory "crynux-on-base"
