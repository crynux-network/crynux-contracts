# Primary Deployment

This directory defines the Primary deployment workflow for `testnet` and `mainnet`.

`Primary` identifies the blockchain environment whose canonical CNX supply and emission accounting originate on Ethereum. See [../../docs/emission.md](../../docs/emission.md) for the complete emission and supply-accounting contract.

## Primary Environment

Ethereum MUST be the canonical CNX ERC20 supply chain and the only chain in the Primary environment that deploys the `Primary` emission contract.

CNX MUST reach each downstream branch from Ethereum through that branch's recorded canonical bridge path. Base, Crynux on Base, Robinhood Chain, Crynux on RH, and NEAR MUST NOT deploy another Primary emission contract.

The downstream branch specifications are:

- [Base branch](./base-layer.md): Ethereum → Base → Crynux on Base.
- [Robinhood branch](./robinhood-layer.md): Ethereum → Robinhood Chain → Crynux on RH.
- [NEAR branch](./near-layer.md): Ethereum → NEAR.

Each branch document owns its bridge boundaries, network configuration, deployment commands, operation commands, runtime files, and acceptance requirements. This README MUST NOT redefine those branch-specific requirements.

## Directory Model

The deployment files are separated by responsibility:

- `scripts/` contains shared command implementations and network-specific command entries.
- `testnet/` contains testnet configuration and deployment artifacts.
- `mainnet/` contains mainnet configuration and deployment artifacts.
- `testnet/common.json` and `mainnet/common.json` contain environment-wide receiver addresses.

Network directories MUST contain only configuration and deployment artifacts. Private keys MUST NOT be committed.

## Command Requirements

Run commands from the repository root.

Every TypeScript deployment command MUST select exactly one environment:

- `--network=testnet`
- `--network=mainnet`

Store the EVM deployer keys in the Hardhat keystore:

```powershell
npx hardhat keystore set TESTNET_DEPLOYER_PRIVATE_KEY
npx hardhat keystore set MAINNET_DEPLOYER_PRIVATE_KEY
```

The selected environment's deployer key MUST control Ethereum transactions and the EVM branch transactions assigned to that deployer. NEAR account and key requirements are defined only in [near-layer.md](./near-layer.md).

## Ethereum Configuration

The selected environment's `common.json` MUST define:

- `daoTreasuryAddress`
- `relayWalletColdAddress`

The selected Ethereum `config.json` MUST define an `emission` object containing:

- `mode`
- `startTimestamp`
- `initialEmissionIndex`
- `initCostCNX`

The selected Ethereum `contracts.json` MUST record:

- `crynuxTokenAddress`
- `emissionContractAddress`
- `deployedAtBlockNumber`

Testnet files are stored under `testnet/ethereum-sepolia/`. Mainnet files are stored under `mainnet/ethereum/`.

## Ethereum Deployment

### Deploy Canonical CNX

```powershell
npx tsx deployments/primary/scripts/ethereum/deploy-token.ts --network=<testnet|mainnet>
```

The command MUST deploy canonical CNX ERC20 through Hardhat Ignition, read the deployed token address from Ignition output, and write it to the selected Ethereum `contracts.json`.

### Deploy And Fund Primary Emission

```powershell
npx tsx deployments/primary/scripts/ethereum/deploy-emission.ts --network=<testnet|mainnet>
```

The command MUST read the environment-wide receiver addresses and Ethereum emission parameters, validate every required address, deploy `EmissionERC20`, derive its funding amount from the canonical CNX total supply and `initCostCNX`, fund it with that amount, and write the emission address to the selected Ethereum `contracts.json`.

### Execute Emission

```powershell
npx tsx deployments/primary/scripts/ethereum/execute-emission.ts --network=<testnet|mainnet>
```

The command MUST read the recorded canonical CNX and emission addresses, print the current emission state, execute `emission()` for the due period, wait for the transaction receipt, and print the resulting state.

## Ethereum Acceptance

The selected Ethereum deployment MUST satisfy all of the following:

- `contracts.json` records deployed bytecode for canonical CNX and `EmissionERC20`.
- `EmissionERC20` uses the selected environment's configured mode, start time, initial emission index, initial cost, DAO treasury, and Relay Wallet Cold address.
- The emission contract holds the funding amount derived from the canonical CNX total supply and `initCostCNX` before scheduled emission execution begins.
- No downstream branch deploys an additional Primary emission contract.
