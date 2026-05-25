# Contract Roles and Status

This document specifies the role of each top-level contract in `crynux-contracts` under the current Crynux architecture.

## Architecture Boundary

The current production architecture SHALL keep task dispatching, task assignment, task validation, and task lifecycle orchestration off-chain in Relay.

The smart contracts in current production usage MUST retain only on-chain state that Relay or node operators require for:

- node staking
- delegated staking
- bootstrap credits
- beneficial address binding
- governed operational parameter control
- parent chain ERC-20 token representation for L2 rollup launch requirements

Contracts that implement the earlier fully on-chain task consensus design are retained in this repository, but they MUST NOT be treated as the active Relay integration surface.

## Active Relay Integration Set

The active on-chain contract set for Relay integration MUST be:

| Contract | Status | Purpose |
|----------|--------|---------|
| `NodeStaking.sol` | Active | Operator staking source of truth and operator-side slash execution |
| `DelegatedStaking.sol` | Active | Delegator staking source of truth, delegator share, and delegated-stake slash execution |
| `Credits.sol` | Active | Bootstrap staking credits for first-node onboarding in the testnet flow |
| `BenefitAddress.sol` | Active | Immutable payout binding for node-side balance returns and external payout systems |
| `ParameterController.sol` | Active | Writer-gated governance controller for operational staking and credits parameters |
| `CrynuxToken.sol` | Active | Parent chain ERC-20 Crynux token for L2 rollup launch requirements |
| `EmissionERC20.sol` | Active | Time-gated ERC-20 emission schedule execution for EVM L1 and mirror environments that require an on-chain emission contract |

Relay configuration and client initialization MUST reference the staking and credits contracts as the runtime integration boundary. Governance and operator tooling that updates operational parameters MUST reference `ParameterController.sol`.

## Active Contract Responsibilities

### `NodeStaking.sol`

`NodeStaking.sol` MUST be the source of truth for operator-side staking. It MUST manage node operator stake amounts and staking status, enforce the minimum operator stake, support Relay-triggered unstake and slash through the configured `adminAddress`, and expose staking data for Relay synchronization. It MUST integrate with `Credits.sol` for bootstrap staking credits, `BenefitAddress.sol` for unstake payout destination, and `DelegatedStaking.sol` for delegated-stake slash coordination. It MUST accept governed operational parameter updates only from the configured parameter controller. Its `slashReceiverAddress` MUST be constructor-configured and immutable after deployment.

### `DelegatedStaking.sol`

`DelegatedStaking.sol` MUST be the source of truth for delegated staking and delegator share. It MUST manage delegation amounts and node-level delegator share, expose node and delegator staking views for Relay synchronization, coordinate node-level delegated staking slash when called by `NodeStaking.sol`, and clear or return delegation state when delegated staking is closed for a node. Its on-chain slash signal MUST remain node-level rather than per-delegator. It MUST accept governed operational parameter updates only from the configured parameter controller. Its `nodeStakingAddress` MUST be initialized once during deployment and MUST NOT be changed afterward. Its `slashReceiverAddress` MUST be constructor-configured and immutable after deployment.

### `Credits.sol`

`Credits.sol` MUST provide bootstrap staking credits for node onboarding. In the current testnet flow, it MUST support off-chain approved credit minting for new operators, staking-only movement of credits into node staking, and unstake-only return of those credits. It MUST remain active even though it is not part of task dispatching, because Relay uses it for the credits request flow and staked credits remain slashable once moved into `NodeStaking.sol`. Its `stakingAddress` MUST be initialized once during deployment and MUST NOT be changed afterward. It MUST accept governed operational parameter updates only from the configured parameter controller.

### `ParameterController.sol`

`ParameterController.sol` MUST provide writer-gated governance execution for operational parameters on `NodeStaking.sol`, `DelegatedStaking.sol`, and `Credits.sol`. It MUST enforce that only the configured writer can execute supported parameter update calls, and it MUST allow owner-controlled writer handoff for governance transition.

### `BenefitAddress.sol`

`BenefitAddress.sol` MUST provide the immutable mapping from a node operational address to its beneficial address. It MUST remain outside task dispatching and task validation, while staying active as the payout destination source of truth for operator-side unstake returns and Relay-controlled withdrawal flows.

### `CrynuxToken.sol`

`CrynuxToken.sol` MUST provide the ERC-20 Crynux token representation on the parent chain required by L2 rollup chain launch flows. It MUST remain outside task dispatching, task assignment, and task validation.

### `EmissionERC20.sol`

`EmissionERC20.sol` MUST hold the locked CNX emission inventory and release CNX by a fixed, hardcoded schedule. It MUST support `Primary` and `Mirror` modes selected at deployment time. The `daoTreasuryAddress` and `relayWalletColdAddress` MUST be constructor-configured and immutable after deployment.

In `Primary` mode, each due emission period MUST distribute CNX between `daoTreasuryAddress` and `relayWalletColdAddress` by the configured year-based percentages. In `Mirror` mode, each due emission period MUST transfer all emitted CNX to `relayWalletColdAddress`, and MUST NOT transfer emission CNX to `daoTreasuryAddress`.

The emission execution entrypoint MUST be public and time-gated. If one or more past periods were missed, later calls MUST release the next unpaid period in order until caught up. A completed period MUST NOT be released more than once.

`EmissionERC20.sol` MUST be used for EVM-based L1 deployments. L2 MUST NOT deploy a separate token contract. When native CNX bridging from L1 to L2 exists, L2 MUST NOT deploy an emission contract. When native CNX bridging does not exist, L2 mirror emission MAY be implemented with `EmissionERC20.sol`.

## Legacy Contract Stack Retained in Repository

The following contracts implement the earlier fully on-chain consensus and task dispatching design. They are retained in the repository, but they MUST NOT be treated as the active Relay integration surface.

| Contract | Legacy role | Current status |
|----------|-------------|----------------|
| `VSSTask.sol` | On-chain task lifecycle, validation sampling, and slash trigger | Legacy |
| `Node.sol` | On-chain node registry, availability state, and legacy slash path | Legacy |
| `TaskQueue.sol` | On-chain task queue and scheduling support | Legacy |
| `QOS.sol` | On-chain QoS scoring for the legacy task path | Legacy |
| `NetworkStats.sol` | On-chain network and task statistics for the legacy task path | Legacy |
| `Random.sol` | Randomness helper for the legacy task path | Legacy |

### Legacy `VSSTask` Path

`VSSTask.sol` imports `Node.sol` and calls `node.slash(taskInfo.selectedNode)` on `TaskStatus.EndInvalidated`.

This path belongs to the earlier design in which task dispatching and validation were executed on-chain.

This path MUST be treated as obsolete for the current Relay architecture.

### Legacy Deployment Artifacts

Historical migration scripts and Hardhat test fixtures deployed the legacy `Node` and `Task` stack.

Those scripts and tests MUST be interpreted as legacy coverage for the earlier on-chain consensus design. They MUST NOT be used as the source of truth for the current Relay integration set.

## Source of Truth for Current Integration

For the current production architecture, the source of truth for contract usage MUST be:

1. the Relay blockchain contract configuration
2. the Relay blockchain client bindings
3. the active staking and delegation flows implemented around `NodeStaking.sol`, `DelegatedStaking.sol`, `Credits.sol`, and `BenefitAddress.sol`
4. the active governed parameter update flow implemented around `ParameterController.sol`
5. the parent chain ERC-20 token deployment flow implemented around `CrynuxToken.sol`
6. the active Primary and Mirror emission release flow implemented around `EmissionERC20.sol`

The presence of additional contracts in this repository SHALL NOT imply active production usage.
