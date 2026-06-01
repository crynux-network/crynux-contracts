# Primary Deployment

This directory contains the deployment configuration for the Primary blockchain environment.

The current implementation under `testnet/` targets Ethereum Sepolia, Base Sepolia, and Crynux on Base Sepolia. Ethereum Sepolia is the Ethereum testnet, while Base Sepolia is the Base testnet in the same testnet generation. The same structure applies to mainnet when the validated testnet flow is promoted.

## Environment Model

`Primary` identifies the blockchain environment that owns real CNX emission accounting for the global token economy.

See [../../docs/emission.md](../../docs/emission.md) for the full emission topology and accounting model.

This environment has a special three-chain shape:

- Ethereum is the top-level chain that owns the canonical CNX ERC20 supply and the `Primary` emission contract.
- Base is an Ethereum L2, and it is treated as the L1 environment for `Crynux on Base` because the `Crynux on Base` is an L2 rollup which attaches to Base as L1. The canonical Ethereum ERC20 token has a bound ERC20 representation on Base, and CNX can move between Ethereum and Base through bridges.
- `Crynux on Base` is the L2 execution environment. CNX is bridged from Base into `Crynux on Base` and becomes the L2 native token.

The Primary environment deploys the emission contract only on Ethereum. Base and `Crynux on Base` do not deploy emission contracts in this architecture because CNX supply reaches them through the bridge path from Ethereum to Base and then from Base to `Crynux on Base`.

## Testnet Deployment Flow

Private keys are configured through Hardhat network accounts. `common.json` contains only shared receiver addresses.

Set the deployer private key before running any deployment step:

```shell
npx hardhat keystore set DEPLOYER_PRIVATE_KEY
```

Set the operator private keys before deploying Crynux on Base Sepolia:

```shell
npx hardhat keystore set L2_BATCH_POSTER_PRIVATE_KEY
npx hardhat keystore set L2_VALIDATOR_PRIVATE_KEY
```

### Ethereum Sepolia

Ethereum Sepolia is the testnet top-level chain for canonical CNX supply and `Primary` emission accounting.

1. Fill `common.json` with `daoTreasuryAddress` and `relayWalletColdAddress`, and fill `testnet/ethereum-sepolia/config.json` with the emission parameters: `mode`, `startTimestamp`, `initialEmissionIndex`, `initCostCNX`, and `fundingAmountWei`.
2. Run `npx tsx deployments/primary/testnet/ethereum-sepolia/deploy-token.ts`. The script takes no CLI parameters; it deploys the canonical CNX ERC20 token on Ethereum Sepolia through Hardhat Ignition, reads the deployed token address from Ignition output, and writes it to `testnet/ethereum-sepolia/contracts.json`.
3. Run `npx tsx deployments/primary/testnet/ethereum-sepolia/deploy-emission.ts`. The script takes no CLI parameters; it reads the receiver addresses and emission parameters from the JSON files, validates the recorded token and shared receiver addresses, writes the Hardhat Ignition parameter file, deploys and funds `EmissionERC20` through Hardhat Ignition, reads the deployed emission address from Ignition output, and writes it to `testnet/ethereum-sepolia/contracts.json`.
4. Run `npx tsx deployments/primary/testnet/ethereum-sepolia/execute-emission.ts`. The script takes no CLI parameters; it reads the recorded token and emission addresses, prints the current emission state, calls `emission()` for the next due period, waits for the transaction receipt, and prints the updated emission state.


### Base Sepolia

Base Sepolia receives CNX from Ethereum Sepolia through the Base Standard Bridge and acts as the L1 parent for `Crynux on Base Sepolia`.

1. Confirm the Ethereum Sepolia CNX token address is recorded in `testnet/ethereum-sepolia/contracts.json`.
2. Run `npx tsx deployments/primary/testnet/base-sepolia/create-bridged-token.ts`. The script takes no CLI parameters. This script creates the bound ERC20 representation through the Base Sepolia `OptimismMintableERC20Factory` and records the created token address in `testnet/base-sepolia/contracts.json`.
3. Run `npx tsx deployments/primary/testnet/base-sepolia/bridge-cnx-from-ethereum.ts <amount>`, where `<amount>` is the integer CNX amount to bridge from Ethereum Sepolia to Base Sepolia. This script checks the Ethereum Sepolia deployer balance and allowance, approves the Base Sepolia `L1StandardBridge` when required, calls `bridgeERC20`, waits 120 seconds, and prints the deployer's Base Sepolia CNX balance.

### Crynux On Base Sepolia

`Crynux on Base Sepolia` is an L2 (L3 for Ethereum) Arbitrum Orbit chain whose parent chain is Base Sepolia.

1. Confirm the Base Sepolia CNX token address is recorded in `testnet/base-sepolia/contracts.json`.
2. Run `npx tsx deployments/primary/testnet/crynux-on-base-sepolia/create-rollup.ts`. The script takes no CLI parameters and deploys the Orbit core contracts on Base Sepolia and records them in `testnet/crynux-on-base-sepolia/contracts.json`.
3. Prepare the DAC key pair, DAC keyset, and related config according to [dac.md](./testnet/crynux-on-base-sepolia/dac.md).
4. Update `testnet/crynux-on-base-sepolia/daserver.json` with the recorded `contracts.coreContracts.sequencerInbox` address.
5. Run `npx tsx deployments/primary/testnet/crynux-on-base-sepolia/set-dac-keyset.ts`. The script takes no CLI parameters and submits the generated DAC keyset to the recorded `SequencerInbox`.
6. Run `npx tsx deployments/primary/testnet/crynux-on-base-sepolia/generate-nitro-node-config.ts`. The script takes no CLI parameters.
7. Fund the validator and batch poster accounts with enough Base Sepolia ETH for gas before starting the private operators service. Also fund the validator account with 1 Base Sepolia CNX for staking.
8. Start the Nitro node and DAS services with `testnet/crynux-on-base-sepolia/nitro-node/docker-compose.public.yml` and `testnet/crynux-on-base-sepolia/nitro-node/docker-compose.private.yml`, using the generated Nitro configs, `daserver.json`, and the same BLS key used to generate the DAC keyset.
9. Initialize the sequencer coordinator priority list after Redis starts. The URL must exactly match `node.seq-coordinator.my-url` in `nitro-node/nitro-node.public.json`.

```bash
docker compose -f nitro-node/docker-compose.public.yml exec sequencer-redis \
  redis-cli -p 6488 -a '<redis-password>' \
  SET coordinator.priorities '<public-rpc-sequencer-url>'
```

For a single public sequencer, `coordinator.priorities` contains only that sequencer URL. Do not add the private operators service to this list.

10. Run `npx tsx deployments/primary/testnet/crynux-on-base-sepolia/set-min-l2-base-fee.ts`. The script takes no CLI parameters and sets the configured minimum L2 base fee after the L2 RPC is reachable.
11. Run `npx tsx deployments/primary/testnet/crynux-on-base-sepolia/create-token-bridge.ts`. The script takes no CLI parameters.
12. Run `npx tsx deployments/primary/testnet/crynux-on-base-sepolia/deposit-base-cnx-to-crynux.ts <amount>`, where `<amount>` is the decimal CNX amount to deposit from Base Sepolia into Crynux on Base Sepolia.

The rollup script deploys the Orbit core contracts on Base Sepolia and records them in `testnet/crynux-on-base-sepolia/contracts.json`. The DAC keyset script submits the generated AnyTrust keyset to the rollup `SequencerInbox`. The Nitro config script writes the public and private node config files from the recorded rollup contracts, DAC endpoints, and configured keys. The token bridge script deploys or reads the Orbit token bridge contracts from the recorded rollup contracts. The deposit script checks Base Sepolia CNX balance and allowance, approves the Orbit inbox when required, and deposits CNX to mint native CNX on Crynux on Base Sepolia.

Nitro node config generation always writes two files:

- `nitro-node/nitro-node.public.json` for public RPC, sequencer, DAS, and coordinator services.
- `nitro-node/nitro-node.private.json` for batch poster and validator services.

The same two files can be deployed on one machine or split across two machines. Deployment topology is an operations choice, not a different config generation mode.
