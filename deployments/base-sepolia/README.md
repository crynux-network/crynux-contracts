# Base Sepolia Rollup Deployment

This directory contains the scripts for deploying and configuring the Base Sepolia Crynux AnyTrust rollup.

## Prerequisites

Install project dependencies from the repository root:

```powershell
npm install
```

Store the rollup deployer, batch poster, and validator private keys in the Hardhat keystore:

```powershell
npx hardhat keystore set L2_ROLLUP_DEPLOYER_PRIVATE_KEY
npx hardhat keystore set L2_BATCH_POSTER_PRIVATE_KEY
npx hardhat keystore set L2_VALIDATOR_PRIVATE_KEY
```

Docker must be available because the DAC key tooling is provided by the Nitro image.

Base Sepolia uses `https://sepolia.base.org` by default. Set `BASE_SEPOLIA_RPC_URL` to override it:

```powershell
$env:BASE_SEPOLIA_RPC_URL = "https://your-base-sepolia-rpc.example"
```

## Configure `config.json`

Update `config.json` before running the deployment scripts:

- `l1CrynuxTokenAddress`: L1 Crynux token address on Base Sepolia.
- `l2ChainId`: Chain ID for the new rollup.
- `l2BatchPosterAddress`: Batch poster address for the new rollup.
- `l2ValidatorAddress`: Validator address for the new rollup.
- `dacKeyset.assumed-honest`: Number of assumed honest DAC members.
- `dacKeyset.backends[].url`: DAS RPC endpoint for each DAC member.
- `dacKeyset.backends[].pubkey`: Base64 BLS public key for each DAC member.
- `dacRestUrls`: DAS REST endpoints used by the Nitro node to retrieve batch data.
- `coreContracts`: Core rollup contracts returned by `create-rollup.ts`; add this after rollup creation.

## Generate A DAS Key Pair

Generate a BLS key pair for a DAS member:

```powershell
.\deployments\base-sepolia\generate-das-keypair.ps1
```

The script writes the key files to:

```text
deployments/base-sepolia/keys/
```

Use `keys/das_bls.pub` as the DAC backend `pubkey` in `config.json`. Keep `keys/das_bls` private and use it only for running the DAS.

## Generate The Serialized DAC Keyset

After `config.json` contains the final DAC backend URLs and public keys, generate the serialized keyset:

```powershell
.\deployments\base-sepolia\generate-dac-keyset.ps1
```

This script writes:

```text
deployments/base-sepolia/dac-keyset.json
```

`dac-keyset.json` contains the serialized `0x...` keyset bytes and the keyset hash. `set-dac-keyset.ts` reads this generated file.

## Create The Rollup

Run the rollup creation script:

```powershell
npx tsx deployments/base-sepolia/create-rollup.ts
```

Copy the printed `Core contracts` object into `config.json` as `coreContracts`. At minimum, `set-dac-keyset.ts` needs:

```json
{
  "coreContracts": {
    "sequencerInbox": "0x...",
    "upgradeExecutor": "0x..."
  }
}
```

## Set The DAC Keyset On Chain

Generate `dac-keyset.json` first if it does not exist or if `config.json` changed:

```powershell
.\deployments\base-sepolia\generate-dac-keyset.ps1
```

Then submit the DAC keyset to the `SequencerInbox`:

```powershell
npx tsx deployments/base-sepolia/set-dac-keyset.ts
```

The script prints the DAC keyset hash and the transaction receipt.

## Generate The Nitro Node Config

After `config.json` contains `coreContracts` and the operator private keys are stored in the Hardhat keystore, generate the Nitro node config:

```powershell
npx tsx deployments/base-sepolia/generate-nitro-node-config.ts
```

The script writes:

```text
deployments/base-sepolia/nitro-node.json
```

The generated file contains operator private keys and is ignored by git.

The Docker Compose DAS service runs `anytrustserver` and reads `daserver.json` through `--conf.file`. Update that file when the DAS parent-chain RPC, `SequencerInbox`, key directory, or storage path changes.

In the included Docker Compose file, the DAS service is named `das`. Other services in the same Compose network can reach it at `http://das:9876` for RPC and `http://das:9877` for REST.

## Typical Command Order

```powershell
npm install
npx hardhat keystore set L2_ROLLUP_DEPLOYER_PRIVATE_KEY
npx hardhat keystore set L2_BATCH_POSTER_PRIVATE_KEY
npx hardhat keystore set L2_VALIDATOR_PRIVATE_KEY
.\deployments\base-sepolia\generate-das-keypair.ps1
.\deployments\base-sepolia\generate-dac-keyset.ps1
npx tsx deployments/base-sepolia/create-rollup.ts
npx tsx deployments/base-sepolia/set-dac-keyset.ts
npx tsx deployments/base-sepolia/generate-nitro-node-config.ts
```

After `create-rollup.ts` completes, update `config.json` with the printed `coreContracts` before running `set-dac-keyset.ts` and `generate-nitro-node-config.ts`.
