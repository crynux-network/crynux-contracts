# Contract Roles and Status

This document specifies the role of each top-level contract in `crynux-contracts` under the current Crynux architecture.

## Architecture Boundary

The production architecture SHALL keep task dispatching, task assignment, task validation, and task lifecycle orchestration off-chain in Relay.

The active smart contracts MUST retain only on-chain state required for node staking, delegated staking, beneficial address binding, governed operational parameters, parent-chain token representation, and emission.

`Credits.sol`, `ParameterController.sol`, and `ParameterControlled.sol` do not belong to the current architecture. They MUST NOT be deployed, imported, or referenced by new integrations.

## Active Relay Integration Set

| Contract | Status | Purpose |
|----------|--------|---------|
| `NodeStaking.sol` | Active | Native CNX operator staking, unstake, slash, and stake-change notification |
| `DelegatedStaking.sol` | Active | Native CNX delegation, delegator share, slash, and stake-change notification |
| `BenefitAddress.sol` | Active | One-time node payout binding |
| `CrynuxToken.sol` | Active | Parent-chain ERC-20 representation required by L2 launch |
| `EmissionERC20.sol` | Active | Time-gated ERC-20 emission for applicable EVM environments |

Relay configuration MUST reference `NodeStaking`, `DelegatedStaking`, and `BenefitAddress`. Governance MUST update supported staking parameters through the staking contracts' `onlyOwner` setters.

## Active Contract Responsibilities

### `NodeStaking.sol`

`NodeStaking` MUST accept native CNX only. It MUST store operator stake amounts and status, enforce `minStakeAmount`, support Relay-authorized unstake and slash through `adminAddress`, and resolve unstake payouts through the constructor-fixed `BenefitAddress`.

`NodeStaking` MUST keep `BenefitAddress` and `slashReceiver` fixed after deployment. It MUST allow Owner to update `adminAddress`, `minStakeAmount`, `forceUnstakeDelay`, and `observer` with validated setters and change events.

After a stake amount changes, `NodeStaking` MUST notify the nonzero observer with the node address after storage updates and before any native CNX transfer. A zero or reverting observer MUST revert the complete amount-changing transaction. `tryUnstake` MUST require a nonzero observer because it starts the later Relay or force-unstake flow, but it MUST NOT notify the observer because the amount has not changed. A `stake` call that keeps the amount unchanged MUST NOT notify the observer.

### `DelegatedStaking.sol`

`DelegatedStaking` MUST store delegation amounts and node delegator shares, expose staking views for Relay synchronization, and execute Relay-authorized delegated slash batches through `slashNodeDelegations(address,address[])`.

`DelegatedStaking` MUST keep `slashReceiver` fixed after deployment. It MUST allow Owner to update `adminAddress`, `minStakeAmount`, and `observer` with validated setters and change events.

After a delegator's total stake changes, `DelegatedStaking` MUST notify the nonzero observer with the delegator address after storage updates and before any native CNX transfer. A batch slash MUST notify every affected delegator. A zero or reverting observer MUST revert the complete amount-changing transaction or batch. `setDelegatorShare` and a `stake` call that keeps the amount unchanged MUST NOT notify the observer.

### `BenefitAddress.sol`

`BenefitAddress` MUST allow each node to set one nonzero benefit address exactly once. Owner MUST NOT set, replace, or clear a node's benefit address.

### `CrynuxToken.sol`

`CrynuxToken` MUST provide the parent-chain ERC-20 Crynux token representation required by L2 launch flows. It MUST remain outside task dispatching, task assignment, and task validation.

### `EmissionERC20.sol`

`EmissionERC20` MUST hold locked CNX inventory and release CNX according to its fixed schedule. `daoTreasuryAddress` and `relayWalletColdAddress` MUST remain constructor-configured and immutable.

In `Primary` mode, each due period MUST distribute CNX according to the configured year schedule. In `Mirror` mode, each due period MUST transfer all emitted CNX to `relayWalletColdAddress`.

## Ownership

The deployer MUST initially own `NodeStaking`, `DelegatedStaking`, and `BenefitAddress`. After `CouncilRegistry` is configured as both staking observers, ownership of both staking contracts MUST transfer to `CouncilGovernor`.

Ownership MUST NOT provide a method to replace `BenefitAddress`, replace either `slashReceiver`, write user staking balances, write delegator share, write benefit-address mappings, withdraw arbitrary native CNX, or execute arbitrary external calls.

## Legacy Contract Stack

`VSSTask.sol`, `Node.sol`, `TaskQueue.sol`, `QOS.sol`, `NetworkStats.sol`, and `Random.sol` implement the earlier on-chain task design. They MUST NOT be treated as the active Relay integration surface.

Historical deployment records that contain Credits or ParameterController addresses MUST remain historical records. They MUST NOT be treated as evidence that the current implementation has been deployed.

Existing deployed staking contracts are non-proxy contracts. Their bytecode and storage MUST NOT change in place. Enabling the current implementation requires deployment at new addresses.
