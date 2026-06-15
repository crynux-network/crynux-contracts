# DAC Setup

This rollup uses Arbitrum AnyTrust. The rollup core contracts can be deployed before the DAC key pair and serialized keyset are prepared. After `create-rollup.ts` records the core contracts, prepare the DAC keyset and commit it on chain with `set-dac-keyset.ts`. The DAS service does not need to be started before rollup creation.

## Generate A DAS Key Pair

Run the key generation script from the repository root:

```powershell
.\deployments\primary\scripts\crynux-on-base\generate-das-keypair.ps1 -Network testnet
```

Replace `testnet` with `mainnet` when preparing the mainnet environment.

The script writes the BLS key pair to:

```text
deployments/primary/<network>/crynux-on-base*/keys/
```

Use `keys/das_bls.pub` as the DAC backend public key in `config.json`. Keep `keys/das_bls` private and mount it only into the DAS service.

## Prepare The DAS Server Config

The DAS service reads `daserver.json` when the Nitro node stack starts. Before starting the docker compose stack, confirm these fields:

- `parent-chain.node-url`: Base RPC URL for the selected network.
- `parent-chain.sequencer-inbox-address`: `contracts.coreContracts.sequencerInbox` after `create-rollup.ts` records it in `contracts.json`.
- `data-availability.key.key-dir`: directory that contains `das_bls` and `das_bls.pub` inside the DAS container.
- `data-availability.local-file-storage.data-dir`: persistent DAS data directory inside the DAS container.

Replace the zero `sequencer-inbox-address` placeholder after rollup creation, before starting the Nitro node docker compose stack.

The DAS service is started together with the Nitro node services through docker compose. The compose stack must mount the same BLS key pair used to generate the DAC keyset and expose the RPC/REST addresses written to `config.json`.

## Fill The DAC Fields

Update `config.json` before generating the DAC keyset:

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

Use URLs that the Nitro node can reach. If Nitro runs in the same Docker network as the DAS service, `http://das:9876` and `http://das:9877` are appropriate. If Nitro reaches DAS through a public or private host, use those reachable addresses instead.

## Generate The Serialized DAC Keyset

After `config.json` contains the final DAC backend RPC URLs and BLS public keys, run:

```powershell
.\deployments\primary\scripts\crynux-on-base\generate-dac-keyset.ps1 -Network testnet
```

Replace `testnet` with `mainnet` when preparing the mainnet environment.

The script uses Nitro `anytrusttool dumpkeyset` and writes the generated `keyset` and `keysetHash` into the selected network `config.json` under `generatedDacKeyset`.

After `create-rollup.ts` records `contracts.coreContracts` and `generatedDacKeyset.keyset` is present, submit the keyset on chain:

```powershell
npx tsx deployments/primary/scripts/crynux-on-base/set-dac-keyset.ts --network=testnet
```

Then generate the Nitro node configs and start the docker compose stack that runs both the Nitro node and DAS services.
