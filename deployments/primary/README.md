# Primary Deployment

This directory defines the Primary deployment workflow for both `testnet` and `mainnet`.

`Primary` identifies the blockchain environment that owns real CNX emission accounting for the global token economy.

See [../../docs/emission.md](../../docs/emission.md) for the full emission topology and accounting model.

## Directory Model

The deployment model is split by responsibility:

- `scripts/` stores one shared script set for all networks.
- `testnet/` stores only testnet configuration and artifacts.
- `mainnet/` stores only mainnet configuration and artifacts.

The three deployment layers are always:

- `ethereum` / `ethereum-sepolia`
- `base` / `base-sepolia`
- `crynux-on-base` / `crynux-on-base-sepolia`

Each network folder MUST contain only configuration and artifacts such as:

- `common.json`
- `*/config.json`
- `*/contracts.json`
- `*/daserver.json`
- `*/nitro-node/*.json`
- `*/nitro-node/*.yml`

## Network Selection

All TypeScript scripts under `scripts/` MUST be run with:

- `--network=testnet`
- `--network=mainnet`

Example:

```shell
npx tsx deployments/primary/scripts/ethereum/deploy-token.ts --network=testnet
```

## Keystore Requirements

Set deployer keys in Hardhat keystore:

```shell
npx hardhat keystore set TESTNET_DEPLOYER_PRIVATE_KEY
npx hardhat keystore set MAINNET_DEPLOYER_PRIVATE_KEY
```

## Primary Environment Model

Primary has a three-chain shape:

- Ethereum is the canonical CNX ERC20 supply chain and hosts the `Primary` emission contract.
- Base is an Ethereum L2 and is the parent chain for `Crynux on Base`.
- `Crynux on Base` is an Arbitrum Orbit chain where CNX is bridged from Base and becomes the L2 native token.

The Primary environment deploys the emission contract only on Ethereum. Base and `Crynux on Base` MUST NOT deploy emission contracts. CNX supply reaches Base and `Crynux on Base` through bridge flows.

## Deployment Flow

### 1) Ethereum Layer

1. Fill `<network>/common.json` with `daoTreasuryAddress` and `relayWalletColdAddress`.
2. Fill `<network>/<ethereum-layer>/config.json` with `mode`, `startTimestamp`, `initialEmissionIndex`, `initCostCNX`, and `fundingAmountWei`.
3. Deploy token:
   - `npx tsx deployments/primary/scripts/ethereum/deploy-token.ts --network=<testnet|mainnet>`
   - This script deploys canonical CNX ERC20 through Hardhat Ignition, reads the deployed token address from Ignition output, and writes the address to `<network>/<ethereum-layer>/contracts.json`.
4. Deploy and fund emission contract:
   - `npx tsx deployments/primary/scripts/ethereum/deploy-emission.ts --network=<testnet|mainnet>`
   - This script reads shared receiver addresses and emission parameters, validates required addresses, writes Ignition parameters, deploys and funds `EmissionERC20`, and writes the emission address to `<network>/<ethereum-layer>/contracts.json`.
5. Execute the next emission cycle when due:
   - `npx tsx deployments/primary/scripts/ethereum/execute-emission.ts --network=<testnet|mainnet>`
   - This script reads the recorded token and emission addresses, prints the current emission state, executes `emission()` for the due period, waits for receipt, and prints the updated state.

### 2) Base Layer

1. Confirm Ethereum token is recorded in `<network>/<ethereum-layer>/contracts.json`.
2. Create bridged CNX token:
   - `npx tsx deployments/primary/scripts/base/create-bridged-token.ts --network=<testnet|mainnet>`
   - This script creates the bound ERC20 representation through `OptimismMintableERC20Factory` and records it in `<network>/<base-layer>/contracts.json`.
3. Bridge CNX from Ethereum to Base:
   - `npx tsx deployments/primary/scripts/base/bridge-cnx-from-ethereum.ts <amount> --network=<testnet|mainnet>`
   - `<amount>` MUST be an integer CNX amount.
   - This script checks deployer balance and allowance on Ethereum, approves `L1StandardBridge` when required, calls `bridgeERC20`, waits for bridge processing, and prints the Base CNX balance.
4. Bridge ETH from Ethereum to Base:
   - `npx tsx deployments/primary/scripts/base/bridge-eth-from-ethereum.ts <eth-amount> --network=<testnet|mainnet>`
   - This script bridges parent-chain ETH for Base-side gas funding.
5. Deploy Base BenefitAddress:
   - `npx tsx deployments/primary/scripts/base/deploy-benefit-address.ts --network=<testnet|mainnet>`
   - This script deploys `BenefitAddress` through Hardhat Ignition and writes the deployed address to `<network>/<base-layer>/contracts.json`.
   - Relay withdrawals on Base MUST use this network-local `BenefitAddress` contract to validate payout destinations.
6. Optional token transfer helper:
   - `npx tsx deployments/primary/scripts/base/transfer-cnx.ts <address> <integer-cnx-amount> --network=<testnet|mainnet>`

### 3) Crynux-on-Base Layer

1. Confirm Base token is recorded in `<network>/<base-layer>/contracts.json`.
2. Fill `<network>/<crynux-layer>/config.json`, including:
   - `batchPosterAddress`
   - `validatorAddress`
   - `crynux-contracts-params`

`creditsAdminAddress` MUST be empty when bootstrap credit issuance is disabled.

#### 3.1) Operations On Base Chain

1. Prepare DAC key pair and keyset inputs:
   - `.\deployments\primary\scripts\crynux-on-base\generate-das-keypair.ps1 -Network <testnet|mainnet>`
   - `.\deployments\primary\scripts\crynux-on-base\generate-dac-keyset.ps1 -Network <testnet|mainnet>`
   - Follow `deployments/primary/dac.md` for DAC backend URLs, keyset generation, and DAS constraints.
2. Create rollup core contracts on Base:
   - `npx tsx deployments/primary/scripts/crynux-on-base/create-rollup.ts --network=<testnet|mainnet>`
   - This script creates Orbit core contracts on the Base parent chain and writes `coreContracts` to `<network>/<crynux-layer>/contracts.json`.
3. Submit DAC keyset to `SequencerInbox` on Base after DAC keyset generation is complete:
   - Run this step only after `.\deployments\primary\scripts\crynux-on-base\generate-dac-keyset.ps1 -Network <testnet|mainnet>` has written `generatedDacKeyset` to `<network>/<crynux-layer>/config.json`.
   - `npx tsx deployments/primary/scripts/crynux-on-base/set-dac-keyset.ts --network=<testnet|mainnet>`
4. Fund operator accounts on Base before private operators start:
   - Batch poster and validator accounts MUST have enough Base ETH for gas.
   - Validator account MUST have `1` Base CNX for staking.

#### 3.2) Crynux-on-Base Deployment Steps

1. Update `<network>/<crynux-layer>/daserver.json`:
   - `parent-chain.sequencer-inbox-address` MUST be set to `contracts.coreContracts.sequencerInbox` from `<network>/<crynux-layer>/contracts.json` after rollup creation.
2. Generate Nitro node configs:
   - `npx tsx deployments/primary/scripts/crynux-on-base/generate-nitro-node-config.ts --network=<testnet|mainnet>`
   - This script writes `<network>/<crynux-layer>/nitro-node/nitro-node.public.json` for public RPC, sequencer, DAS, and coordinator services.
   - This script writes `<network>/<crynux-layer>/nitro-node/nitro-node.private.json` for batch poster and validator services.
   - The two configs MAY run on one machine or split across multiple machines.
3. Start Nitro and DAS services:
   - Start `<network>/<crynux-layer>/nitro-node/docker-compose.public.yml`.
   - Start `<network>/<crynux-layer>/nitro-node/docker-compose.private.yml`.
   - The DAS service MUST mount the same BLS key used to generate the submitted DAC keyset.
4. Initialize sequencer coordinator priorities after Redis starts:

```bash
docker compose -f nitro-node/docker-compose.public.yml exec sequencer-redis \
  redis-cli -p 6488 -a '<redis-password>' \
  SET coordinator.priorities '<public-rpc-sequencer-url>'
```

   - `<public-rpc-sequencer-url>` MUST exactly match `node.seq-coordinator.my-url` in `nitro-node.public.json`.
   - For a single public sequencer, `coordinator.priorities` MUST contain only that URL.
   - Private operators service MUST NOT be added to `coordinator.priorities`.

#### 3.3) Post-Deployment Operations On Crynux-on-Base

1. Set minimum L2 base fee after Crynux-on-Base RPC is reachable:
   - `npx tsx deployments/primary/scripts/crynux-on-base/set-min-l2-base-fee.ts --network=<testnet|mainnet>`
2. Set L2 fee receiver accounts:
   - `npx tsx deployments/primary/scripts/crynux-on-base/set-l2-tx-fee-receiver.ts --network=<testnet|mainnet>`
   - This script sets ArbOS infrastructure fee account, network fee account, and L1 pricing reward recipient to `daoTreasuryAddress` from `<network>/common.json`.
3. Deploy Orbit token bridge contracts:
   - `npx tsx deployments/primary/scripts/crynux-on-base/create-token-bridge.ts --network=<testnet|mainnet>`
   - This script sends the parent-chain transaction on Base and waits for retryable execution on Crynux-on-Base.
4. Bootstrap native CNX gas balance when Crynux-on-Base accounts need gas before the Orbit token bridge is deployed:
   - `npx tsx deployments/primary/scripts/crynux-on-base/deposit-native-cnx-to-crynux.ts <amount> --network=<testnet|mainnet>`
   - This script uses only the Orbit core bridge and inbox contracts. It deposits Base CNX as the native gas token on Crynux-on-Base and MUST NOT require Orbit token bridge contracts.
   - This script is for bootstrap gas funding and recovery operations before the token bridge contract set is available.
5. Deposit CNX from Base to Crynux-on-Base through the deployed Orbit token bridge:
   - `npx tsx deployments/primary/scripts/crynux-on-base/deposit-base-cnx-to-crynux.ts <amount> [destinationAddress] --network=<testnet|mainnet>`
   - This script registers the full Orbit token bridge contract set, checks Base CNX balance and allowance, approves the Orbit inbox when required, and deposits CNX to mint native CNX on Crynux-on-Base for `destinationAddress`.
   - `destinationAddress` defaults to the deployer address.
   - This script MUST run only after `create-token-bridge.ts` completes successfully.
6. Deploy Crynux node contracts:
   - `npx tsx deployments/primary/scripts/crynux-on-base/deploy-crynux-contracts.ts --network=<testnet|mainnet>`
   - This script reads `crynux-contracts-params`, writes Ignition parameters, deploys `Credits`, `BenefitAddress`, `DelegatedStaking`, `NodeStaking`, and `ParameterController`, and writes addresses to `<network>/<crynux-layer>/contracts.json`.
7. Run withdrawal and claim operations:
   - `npx tsx deployments/primary/scripts/crynux-on-base/withdraw-crynux-to-base.ts <amount> [destinationAddress] --network=<testnet|mainnet>`
   - `npx tsx deployments/primary/scripts/crynux-on-base/claim-crynux-withdrawal.ts <withdrawalTxHash> --network=<testnet|mainnet>`

## Nitro And DAS Files

Nitro and DAS files are network-scoped and MUST be stored under the selected network folder:

- `<network>/<crynux-layer>/daserver.json`
- `<network>/<crynux-layer>/nitro-node/nitro-node.public.json`
- `<network>/<crynux-layer>/nitro-node/nitro-node.private.json`
- `<network>/<crynux-layer>/nitro-node/docker-compose.public.yml`
- `<network>/<crynux-layer>/nitro-node/docker-compose.private.yml`

When running private operators, real batch poster and validator private keys are pasted into the target machine `nitro-node.private.json`.
