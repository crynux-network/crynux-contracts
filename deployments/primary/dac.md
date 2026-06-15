# DAC Setup

This rollup uses Arbitrum AnyTrust. The rollup core contracts can be deployed before the DAC key pair and serialized keyset are prepared. After `create-rollup.ts` records the selected network core contracts, prepare the DAC keyset and commit it on chain with `set-dac-keyset.ts`. The DAS service does not need to be started before rollup creation.

All DAC scripts are shared under `deployments/primary/scripts/crynux-on-base`. PowerShell scripts MUST receive `-Network testnet` or `-Network mainnet`. TypeScript scripts MUST receive `--network=testnet` or `--network=mainnet`.

The selected network controls all configuration and artifact paths:

- `testnet` uses `deployments/primary/testnet/crynux-on-base-sepolia/`.
- `mainnet` uses `deployments/primary/mainnet/crynux-on-base/`.

## Generate A DAS Key Pair

Run the key generation script from the repository root:

```powershell
.\deployments\primary\scripts\crynux-on-base\generate-das-keypair.ps1 -Network <testnet|mainnet>
```

The script writes the BLS key pair to:

```text
deployments/primary/<network>/<crynux-layer>/keys/
```

Use `keys/das_bls.pub` as the DAC backend public key in the selected network `config.json`. Keep `keys/das_bls` private and mount it only into the DAS service.

## Prepare The DAS Server Config

The DAS service reads the selected network `daserver.json` when the Nitro node stack starts. Before starting the docker compose stack, confirm these fields:

- `parent-chain.node-url`: selected Base parent-chain RPC URL.
- `parent-chain.sequencer-inbox-address`: `contracts.coreContracts.sequencerInbox` after `create-rollup.ts --network=<testnet|mainnet>` records it in the selected network `contracts.json`.
- `data-availability.key.key-dir`: directory that contains `das_bls` and `das_bls.pub` inside the DAS container.
- `data-availability.local-file-storage.data-dir`: persistent DAS data directory inside the DAS container.

The initial network `daserver.json` contains a parent-chain RPC endpoint and a zero `sequencer-inbox-address` placeholder. Replace the placeholder with the selected network sequencer inbox address after rollup creation and before starting the Nitro node docker compose stack.

The DAS service is started together with the Nitro node services through docker compose. The compose stack must mount the same BLS key pair used to generate the DAC keyset and expose the RPC/REST addresses written to `config.json`.

## Fill The DAC Fields

Update the selected network `config.json` before generating the DAC keyset:

```json
{
  "dacKeyset": {
    "assumed-honest": 1,
    "backends": [
      {
        "url": "http://das:9876",
        "pubkey": "<contents of keys/das_bls.pub>"
      }
    ]
  },
  "dacRestUrls": ["http://das:9877"]
}
```

The DAC backend URLs and REST URLs MUST be reachable by the Nitro node. When Nitro and DAS run in the same Docker network, use `http://das:9876` and `http://das:9877`. When Nitro reaches DAS through a public or private host, use the RPC and REST addresses for that host.

## Generate The Serialized DAC Keyset

After the selected network `config.json` contains the final DAC backend RPC URLs and BLS public keys, run:

```powershell
.\deployments\primary\scripts\crynux-on-base\generate-dac-keyset.ps1 -Network <testnet|mainnet>
```

The script uses Nitro `anytrusttool dumpkeyset` and writes the generated `keyset` and `keysetHash` into the selected network `config.json` under `generatedDacKeyset`.

After `create-rollup.ts` records `contracts.coreContracts` and `generatedDacKeyset.keyset` is present, submit the keyset on chain:

```powershell
npx tsx deployments/primary/scripts/crynux-on-base/set-dac-keyset.ts --network=<testnet|mainnet>
```

Then generate the selected network Nitro node configs and start the docker compose stack that runs both the Nitro node and DAS services:

```powershell
npx tsx deployments/primary/scripts/crynux-on-base/generate-nitro-node-config.ts --network=<testnet|mainnet>
```
