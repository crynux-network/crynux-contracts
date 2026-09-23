# Primary Base Branch

This runbook defines the Ethereum → Base → Crynux on Base deployment and operation flow.

Ethereum MUST remain the canonical CNX supply chain and the only chain in this branch that deploys the Primary emission contract. Base and Crynux on Base MUST NOT deploy another Primary emission contract.

The mainnet names and identifiers MUST be:

- Parent chain: `Base`, chain ID `8453`.
- Child chain: `Crynux on Base`, slug `crynux-on-base`, chain ID `18896214`.
- Child RPC: `https://json-rpc.base.crynux.io`.

The testnet names and identifiers MUST be:

- Parent chain: `Base Sepolia`, chain ID `84532`.
- Child chain: `Crynux on Base Sepolia`, slug `crynux-on-base-sepolia`, chain ID `188962142`.
- Child RPC: `https://json-rpc.base-sepolia.crynux.io`.

## Bridge Boundaries

Ethereum ↔ Base MUST use the OP Stack canonical bridge instance deployed specifically for Base or Base Sepolia. These contracts are not OP Mainnet bridge addresses.

Base ↔ Crynux on Base MUST use the Orbit bridge deployed with Crynux on Base. Base Sepolia ↔ Crynux on Base Sepolia MUST use the corresponding testnet Orbit bridge. Neither Orbit bridge may reuse the Ethereum ↔ Base bridge contracts.

Base is an Ethereum L2. Crynux on Base is an Arbitrum Orbit L3 whose parent chain is Base. CNX bridged from Ethereum to Base is represented as ERC20 CNX. CNX bridged from Base to Crynux on Base becomes the L3 native token.

## Deployment Inputs

Run commands from the repository root. Store the deployer private keys in the Hardhat keystore:

```powershell
npx hardhat keystore set TESTNET_DEPLOYER_PRIVATE_KEY
npx hardhat keystore set MAINNET_DEPLOYER_PRIVATE_KEY
```

Set the selected child directory:

```powershell
$Network = "mainnet"
$ChildDir = if ($Network -eq "testnet") {
    "deployments/primary/testnet/crynux-on-base-sepolia"
} else {
    "deployments/primary/mainnet/crynux-on-base"
}
```

Fill the selected Crynux on Base `config.json` before deployment:

- `batchPosterAddress`
- `validatorAddress`
- `dacKeyset`
- `dacRestUrls`
- `production.publicSequencerUrl`
- `crynux-contracts-params`

`crynux-contracts-params` MUST define the Relay operator, fixed slash receiver, both initial minimum stake amounts, and the initial force-unstake delay.

Operator private keys, Redis password, and private Redis host MUST be entered only on the target machines. Do not write Redis password or private Redis host into `config.json`.

## Ethereum ↔ Base Canonical Bridge

1. Confirm the canonical Ethereum CNX address is recorded in the selected Ethereum `contracts.json`.
2. Create and record the Base representation through `OptimismMintableERC20Factory`:

```powershell
npx tsx deployments/primary/scripts/base/create-bridged-token.ts --network=<testnet|mainnet>
```

3. Bridge CNX through `L1StandardBridge`:

```powershell
npx tsx deployments/primary/scripts/base/bridge-cnx-from-ethereum.ts <integer-cnx-amount> --network=<testnet|mainnet>
```

The script MUST check the Ethereum CNX balance and allowance, approve `L1StandardBridge` when required, call `bridgeERC20`, wait for bridge processing, and print the Base CNX balance.

4. Bridge ETH for Base-side gas:

```powershell
npx tsx deployments/primary/scripts/base/bridge-eth-from-ethereum.ts <eth-amount> --network=<testnet|mainnet>
```

5. Deploy the Base `BenefitAddress` used to validate Relay withdrawal destinations:

```powershell
npx tsx deployments/primary/scripts/base/deploy-benefit-address.ts --network=<testnet|mainnet>
```

6. Transfer Base CNX when required:

```powershell
npx tsx deployments/primary/scripts/base/transfer-cnx.ts <address> <integer-cnx-amount> --network=<testnet|mainnet>
```

## Crynux on Base Rollup And DAC

1. Generate the DAS BLS key pair:

```powershell
.\deployments\primary\scripts\crynux-on-base\generate-das-keypair.ps1 -Network <testnet|mainnet>
```

2. Create the AnyTrust rollup on Base:

```powershell
npx tsx deployments/primary/scripts/crynux-on-base/create-rollup.ts --network=<testnet|mainnet>
```

The command MUST write the deployed `coreContracts` to the selected Crynux on Base `contracts.json`.

3. Generate and submit the DAC keyset:

```powershell
.\deployments\primary\scripts\crynux-on-base\generate-dac-keyset.ps1 -Network <testnet|mainnet>
npx tsx deployments/primary/scripts/crynux-on-base/set-dac-keyset.ts --network=<testnet|mainnet>
```

The DAC setup MUST follow [dac.md](./dac.md). The DAS service MUST use the same BLS key that produced the submitted keyset.

4. Set the rollup confirmation period.

`confirmPeriodBlocks` defines how long a Crynux on Base assertion exists on Base before the protocol can confirm it. The Rollup contract is deployed on Base and measures this period with Solidity `block.number`, which is the Base L2 block number. The approximate duration uses a two-second block interval.

Crynux on Base Sepolia is created with the Chain SDK testnet default of `900` blocks, approximately 30 minutes. No confirmation-period update is needed after testnet rollup creation.

Crynux on Base mainnet is created with the Chain SDK mainnet default of `302400` blocks, approximately seven days. Change it to `43200` blocks, approximately one day:

```powershell
npx tsx deployments/primary/scripts/crynux-on-base/set-confirm-period-blocks.ts 43200 --network=mainnet
```

5. Fund the batch poster and validator with enough Base ETH for gas. Fund the validator with `1` Base CNX for rollup staking.
6. Copy `contracts.coreContracts.sequencerInbox` into `daserver.json`.
7. Generate the public and private Nitro configs:

```powershell
npx tsx deployments/primary/scripts/crynux-on-base/generate-nitro-node-config.ts --network=<testnet|mainnet>
```

The generated configs write Redis password and private Redis host placeholders. Replace those placeholders only on the target machines.

## Nitro And DAS Startup

The selected Crynux on Base network directory MUST contain:

- `daserver.json`
- `nitro-node/nitro-node.public.json`
- `nitro-node/nitro-node.private.json`
- `nitro-node/docker-compose.public.yml`
- `nitro-node/docker-compose.private.yml`

Before starting public services, replace the Redis password placeholder in `docker-compose.public.yml` and in `nitro-node.public.json` `node.seq-coordinator.redis-url` on the public host. The same password MUST be used in both files.

Before starting private operators, replace the Redis password and private Redis host placeholders in `nitro-node.private.json` `node.seq-coordinator.redis-url` on the private host. The Redis password MUST match the public Redis password. The private Redis host MUST be the hostname or address that reaches the public sequencer Redis from the private host.

Start the public services, then initialize the sequencer coordinator:

```powershell
docker compose -f "$ChildDir/nitro-node/docker-compose.public.yml" up -d
docker compose -f "$ChildDir/nitro-node/docker-compose.public.yml" exec sequencer-redis redis-cli -p 6488 -a '<redis-password>' SET coordinator.priorities '<public-rpc-sequencer-url>'
```

`<public-rpc-sequencer-url>` MUST exactly match `node.seq-coordinator.my-url` in `nitro-node.public.json`. A single-sequencer deployment MUST record only that URL. The private operator MUST NOT be added to `coordinator.priorities`.

Start the private batch-poster and validator services:

```powershell
docker compose -f "$ChildDir/nitro-node/docker-compose.private.yml" up -d
```

Real batch-poster and validator private keys MUST be entered only in `nitro-node.private.json` on the target machine.

## Crynux on Base Configuration And Contracts

1. Set the minimum L2 base fee after the child RPC is reachable:

```powershell
npx tsx deployments/primary/scripts/crynux-on-base/set-min-l2-base-fee.ts --network=<testnet|mainnet>
```

2. Set the infrastructure fee account, network fee account, and L1 pricing reward recipient to `daoTreasuryAddress`:

```powershell
npx tsx deployments/primary/scripts/crynux-on-base/set-l2-tx-fee-receiver.ts [transactionMaxFeePerGasWei] --network=<testnet|mainnet>
```

3. Deploy the Base ↔ Crynux on Base Orbit token bridge:

```powershell
npx tsx deployments/primary/scripts/crynux-on-base/create-token-bridge.ts --network=<testnet|mainnet>
```

4. Bootstrap native CNX before the Orbit token bridge is available:

```powershell
npx tsx deployments/primary/scripts/crynux-on-base/deposit-native-cnx-to-crynux.ts <amount> --network=<testnet|mainnet>
```

This command MUST use only the Orbit core bridge and inbox contracts.

5. Deposit Base CNX after the Orbit token bridge deployment:

```powershell
npx tsx deployments/primary/scripts/crynux-on-base/deposit-base-cnx-to-crynux.ts <amount> [destinationAddress] --network=<testnet|mainnet>
```

6. Deploy `BenefitAddress`, `DelegatedStaking`, and `NodeStaking`:

```powershell
npx tsx deployments/primary/scripts/crynux-on-base/deploy-crynux-contracts.ts --network=<testnet|mainnet>
```

If `nodeContracts` is already recorded, the command MUST skip deployment.

7. Withdraw and claim native CNX through the Crynux on Base Orbit bridge:

```powershell
npx tsx deployments/primary/scripts/crynux-on-base/withdraw-crynux-to-base.ts <amount> [destinationAddress] --network=<testnet|mainnet>
npx tsx deployments/primary/scripts/crynux-on-base/claim-crynux-withdrawal.ts <withdrawalTxHash> --network=<testnet|mainnet>
```

8. Lock and unlock value-bearing child-to-parent withdrawals:

```powershell
npx tsx deployments/primary/scripts/crynux-on-base/add-native-token-owner.ts <ownerAddress> --network=<testnet|mainnet>
npx tsx deployments/primary/scripts/crynux-on-base/remove-native-token-owner.ts <ownerAddress> --network=<testnet|mainnet>
```

While at least one native-token owner is registered, ArbOS MUST reject every value-bearing child-to-parent message. Removing the last native-token owner MUST reopen withdrawals. On the first run, `add-native-token-owner.ts` MUST enable native-token management with the mandatory seven-day activation delay. The command MUST be run again after that delay to register the owner.

## Files

Base branch files are network-scoped:

- `deployments/primary/scripts/base/`
- `deployments/primary/scripts/crynux-on-base/`
- `deployments/primary/mainnet/base/`
- `deployments/primary/mainnet/crynux-on-base/`
- `deployments/primary/testnet/base-sepolia/`
- `deployments/primary/testnet/crynux-on-base-sepolia/`

Shared Orbit implementation MUST remain under `deployments/primary/scripts/lib/orbit/`.
