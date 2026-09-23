# Primary Robinhood Branch

This runbook defines the Ethereum → Robinhood Chain → Crynux on RH deployment and operation flow.

Ethereum MUST remain the canonical CNX supply chain and the only chain in this branch that deploys the Primary emission contract. Robinhood Chain and Crynux on RH MUST NOT deploy another Primary emission contract.

The mainnet names and identifiers MUST be:

- Parent chain: `Robinhood Chain`, chain ID `4663`.
- Child chain: `Crynux on RH`, slug `crynux-on-rh`, chain ID `18896215`.
- Child RPC: `https://json-rpc.rh.crynux.io`.
- DAS RPC: `https://rpc.das.rh.crynux.io`.
- DAS REST: `https://rest.das.rh.crynux.io`.

The testnet names and identifiers MUST be:

- Parent chain: `Robinhood Chain Testnet`, chain ID `46630`.
- Child chain: `Crynux on RH Testnet`, slug `crynux-on-rh-testnet`, chain ID `188962150`.
- Child RPC: `https://json-rpc.rh-testnet.crynux.io`.
- DAS RPC: `https://rpc.das.rh-testnet.crynux.io`.
- DAS REST: `https://rest.das.rh-testnet.crynux.io`.

## Bridge Boundaries

Ethereum ↔ Robinhood Chain MUST use the Arbitrum canonical bridge instance deployed specifically for Robinhood Chain or Robinhood Chain Testnet. These contracts are not Arbitrum One bridge addresses. This bridge is not a Robinhood-specific bridge protocol.

Robinhood Chain ↔ Crynux on RH MUST use the Orbit token bridge deployed with the new Crynux on RH L3. Robinhood Chain Testnet ↔ Crynux on RH Testnet MUST use the corresponding testnet L3 Orbit token bridge. Neither L3 bridge may reuse the Ethereum ↔ Robinhood Chain bridge contracts.

The official Robinhood Chain protocol-contract addresses are recorded in:

- `deployments/primary/testnet/robinhood-testnet/config.json`
- `deployments/primary/mainnet/robinhood/config.json`

The Crynux on RH rollup and token-bridge addresses MUST be newly deployed and recorded in:

- `deployments/primary/testnet/crynux-on-rh-testnet/contracts.json`
- `deployments/primary/mainnet/crynux-on-rh/contracts.json`

## Deployment Inputs

Run commands from the repository root. Store the deployer private keys in the Hardhat keystore:

```powershell
npx hardhat keystore set TESTNET_DEPLOYER_PRIVATE_KEY
npx hardhat keystore set MAINNET_DEPLOYER_PRIVATE_KEY
```

The generated DAS private key MUST remain uncommitted and MUST be transferred only to the DAS host. Operator private keys MUST be entered only on their target machines. Redis password and private Redis host MUST be entered only on the target machines.

Every command MUST validate the configuration and recorded contract addresses it uses before sending a transaction.

## Ethereum ↔ Robinhood Canonical Bridge

1. Fund the deployer with ETH on Ethereum. Testnet MUST use Ethereum Sepolia ETH.
2. Deposit CNX through the Robinhood Chain canonical bridge. On the first successful deposit, the Robinhood standard gateway deploys the bridged CNX token while executing the retryable ticket. The script waits for completion and records `robinhoodCrynuxTokenAddress` in:

- `deployments/primary/testnet/robinhood-testnet/contracts.json` for testnet
- `deployments/primary/mainnet/robinhood/contracts.json` for mainnet

```powershell
npx tsx deployments/primary/scripts/robinhood/deposit-cnx-from-ethereum.ts <amount> [destinationAddress] --network=<testnet|mainnet>
```

3. Deposit ETH for parent-chain operator gas:

```powershell
npx tsx deployments/primary/scripts/robinhood/deposit-eth-from-ethereum.ts <eth-amount> --network=<testnet|mainnet>
```

4. Withdraw and claim CNX through the same Robinhood-specific canonical bridge instance:

```powershell
npx tsx deployments/primary/scripts/robinhood/withdraw-cnx-to-ethereum.ts <amount> [destinationAddress] --network=<testnet|mainnet>
npx tsx deployments/primary/scripts/robinhood/claim-cnx-withdrawal.ts <withdrawalTxHash> --network=<testnet|mainnet>
```

5. Redeem a failed retryable ticket:

```powershell
npx tsx deployments/primary/scripts/robinhood/redeem-retryable.ts <parentTransactionHash> <retryableCreationId> [gasLimit] [maxFeePerGasGwei] [maxPriorityFeePerGasGwei] --network=<testnet|mainnet>
```

## Crynux on RH Rollup And DAC

1. Set `batchPosterAddress` and `validatorAddress`.

For testnet, write both addresses into `deployments/primary/testnet/crynux-on-rh-testnet/config.json`.

For mainnet, write both addresses into `deployments/primary/mainnet/crynux-on-rh/config.json`.

Write non-empty `0x` addresses for both fields.

2. Create the AnyTrust rollup:

```powershell
npx tsx deployments/primary/scripts/crynux-on-rh/create-rollup.ts --network=<testnet|mainnet>
```

The script resolves the Robinhood `RollupCreator v3.2` address from Chain SDK `0.28.0`, verifies bytecode for the factory and every current template address, and stops before sending the creation transaction if any check fails. It errors if `robinhoodCrynuxTokenAddress`, `batchPosterAddress`, or `validatorAddress` is missing or invalid. If `coreContracts.rollup` already holds a rollup address, it skips creation and leaves that address unchanged.

For testnet, it writes the deployed `coreContracts` into `deployments/primary/testnet/crynux-on-rh-testnet/contracts.json`.

For mainnet, it writes the deployed `coreContracts` into `deployments/primary/mainnet/crynux-on-rh/contracts.json`.

3. Generate a new DAS BLS key pair:

```powershell
.\deployments\primary\scripts\crynux-on-rh\generate-das-keypair.ps1 -Network <testnet|mainnet>
```

Do not commit the generated private key.

For testnet, the script writes the public key into `dacKeyset.backends[0].pubkey` in `deployments/primary/testnet/crynux-on-rh-testnet/config.json`.

For mainnet, the script writes the public key into `dacKeyset.backends[0].pubkey` in `deployments/primary/mainnet/crynux-on-rh/config.json`.

4. Generate and submit the DAC keyset:

```powershell
.\deployments\primary\scripts\crynux-on-rh\generate-dac-keyset.ps1 -Network <testnet|mainnet>
npx tsx deployments/primary/scripts/crynux-on-rh/set-dac-keyset.ts --network=<testnet|mainnet>
```

For testnet, `generate-dac-keyset.ps1` writes `generatedDacKeyset.keyset` and `generatedDacKeyset.keysetHash` into `deployments/primary/testnet/crynux-on-rh-testnet/config.json`.

For mainnet, `generate-dac-keyset.ps1` writes `generatedDacKeyset.keyset` and `generatedDacKeyset.keysetHash` into `deployments/primary/mainnet/crynux-on-rh/config.json`.

5. Set the rollup confirmation period.

`confirmPeriodBlocks` defines how long a Crynux on RH assertion exists on Robinhood Chain before the protocol can confirm it. The Rollup contract is deployed on Robinhood Chain and measures this period with Solidity `block.number`. On Robinhood Chain, Solidity `block.number` tracks the approximate block number of the first non-Arbitrum ancestor: Ethereum Sepolia for testnet and Ethereum mainnet for mainnet. This is different from the Robinhood Chain L2 block number returned by standard block RPC methods. The approximate duration uses a 12-second block interval.

Crynux on RH Testnet is created with the Chain SDK testnet default of `150` blocks, approximately 30 minutes. No confirmation-period update is needed after testnet rollup creation.

Crynux on RH mainnet is created with the Chain SDK mainnet default of `50400` blocks, approximately seven days. Change it to `7200` blocks, approximately one day:

```powershell
npx tsx deployments/primary/scripts/crynux-on-rh/set-confirm-period-blocks.ts 7200 --network=mainnet
```

6. Copy `coreContracts.sequencerInbox` into `daserver.json`.

For testnet, copy `coreContracts.sequencerInbox` from `deployments/primary/testnet/crynux-on-rh-testnet/contracts.json` into `parent-chain.sequencer-inbox-address` in `deployments/primary/testnet/crynux-on-rh-testnet/daserver.json`.

For mainnet, copy `coreContracts.sequencerInbox` from `deployments/primary/mainnet/crynux-on-rh/contracts.json` into `parent-chain.sequencer-inbox-address` in `deployments/primary/mainnet/crynux-on-rh/daserver.json`.

7. Generate both Nitro configs:

```powershell
npx tsx deployments/primary/scripts/crynux-on-rh/generate-nitro-node-config.ts --network=<testnet|mainnet>
```

The generated public config keeps the public sequencer, DAS REST aggregator, sequencer coordinator, `CalldataPrice` surplus mode, `85000` maximum transaction data size, and archive caching. The generated private config keeps the batch poster, validator, DAS RPC and REST aggregators, `assumed-honest = 1`, `90000` maximum DAS batch size, sequencer coordinator, and archive caching.

The generated configs write Redis password and private Redis host placeholders. Replace those placeholders only on the target machines. Do not write Redis password or private Redis host into `config.json`.

8. Fund the `batchPosterAddress` and `validatorAddress` with Robinhood ETH. Fund the `validatorAddress` with `1` Robinhood CNX for rollup staking.

## Nitro And DAS Startup

Before starting public services, replace the Redis password placeholder in `docker-compose.public.yml` and in `nitro-node.public.json` `node.seq-coordinator.redis-url` on the public host. The same password MUST be used in both files.

Before starting private operators, replace the Redis password and private Redis host placeholders in `nitro-node.private.json` `node.seq-coordinator.redis-url` on the private host. The Redis password MUST match the public Redis password. The private Redis host MUST be the hostname or address that reaches the public sequencer Redis from the private host.

Start the mainnet public services, initialize the coordinator priority, and start the private operators:

```powershell
docker compose -f deployments/primary/mainnet/crynux-on-rh/nitro-node/docker-compose.public.yml up -d
docker compose -f deployments/primary/mainnet/crynux-on-rh/nitro-node/docker-compose.public.yml exec rh-mainnet-sequencer-redis redis-cli -p 6488 -a '<rh-mainnet-redis-password>' SET coordinator.priorities 'https://json-rpc.rh.crynux.io'
docker compose -f deployments/primary/mainnet/crynux-on-rh/nitro-node/docker-compose.private.yml up -d
```

Start the testnet public services, initialize the coordinator priority, and start the private operators:

```powershell
docker compose -f deployments/primary/testnet/crynux-on-rh-testnet/nitro-node/docker-compose.public.yml up -d
docker compose -f deployments/primary/testnet/crynux-on-rh-testnet/nitro-node/docker-compose.public.yml exec rh-testnet-sequencer-redis redis-cli -p 6488 -a '<rh-testnet-redis-password>' SET coordinator.priorities 'https://json-rpc.rh-testnet.crynux.io'
docker compose -f deployments/primary/testnet/crynux-on-rh-testnet/nitro-node/docker-compose.private.yml up -d
```

Real batch-poster and validator private keys MUST be entered only in `nitro-node.private.json` on the target machine.

## Crynux on RH Configuration And Contracts

1. Set the minimum L2 base fee:

```powershell
npx tsx deployments/primary/scripts/crynux-on-rh/set-min-l2-base-fee.ts --network=<testnet|mainnet>
```

2. Set the infrastructure fee account, network fee account, and L1 pricing reward recipient.

For testnet, use `daoTreasuryAddress` from `deployments/primary/testnet/common.json`.

For mainnet, use `daoTreasuryAddress` from `deployments/primary/mainnet/common.json`.

```powershell
npx tsx deployments/primary/scripts/crynux-on-rh/set-l2-tx-fee-receiver.ts [transactionMaxFeePerGasWei] --network=<testnet|mainnet>
```

3. Deploy the Robinhood ↔ Crynux on RH Orbit token bridge:

```powershell
npx tsx deployments/primary/scripts/crynux-on-rh/create-token-bridge.ts --network=<testnet|mainnet>
```

4. Bootstrap native CNX before the Orbit token bridge is available:

```powershell
npx tsx deployments/primary/scripts/crynux-on-rh/deposit-native-cnx-to-crynux.ts <amount> --network=<testnet|mainnet>
```

5. Deposit Robinhood CNX after the Orbit token bridge deployment:

```powershell
npx tsx deployments/primary/scripts/crynux-on-rh/deposit-rh-cnx-to-crynux.ts <amount> [destinationAddress] --network=<testnet|mainnet>
```

6. Deploy `BenefitAddress`, `DelegatedStaking`, and `NodeStaking`:

```powershell
npx tsx deployments/primary/scripts/crynux-on-rh/deploy-crynux-contracts.ts --network=<testnet|mainnet>
```

7. Withdraw and claim native CNX through the Crynux on RH Orbit bridge:

```powershell
npx tsx deployments/primary/scripts/crynux-on-rh/withdraw-crynux-to-rh.ts <amount> [destinationAddress] --network=<testnet|mainnet>
npx tsx deployments/primary/scripts/crynux-on-rh/claim-crynux-withdrawal.ts <withdrawalTxHash> --network=<testnet|mainnet>
```

8. Lock and unlock value-bearing child-to-parent withdrawals:

```powershell
npx tsx deployments/primary/scripts/crynux-on-rh/add-native-token-owner.ts <ownerAddress> --network=<testnet|mainnet>
npx tsx deployments/primary/scripts/crynux-on-rh/remove-native-token-owner.ts <ownerAddress> --network=<testnet|mainnet>
```
