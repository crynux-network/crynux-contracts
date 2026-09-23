param([Parameter(Mandatory = $true)][ValidateSet("testnet", "mainnet")][string]$Network)

& (Join-Path $PSScriptRoot "..\lib\orbit\generate-dac-keyset.ps1") `
    -Network $Network `
    -TestnetLayerFolder "crynux-on-rh-testnet" `
    -MainnetLayerFolder "crynux-on-rh" `
    -CommandDirectory "crynux-on-rh"
