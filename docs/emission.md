# Multi-Chain Emission Specification

This document specifies how CNX emission MUST work across multiple chains while preserving one global token economy.

## Design Goals

The emission system MUST satisfy all of the following goals:

- Total CNX supply MUST remain constant at the global level.
- Users MUST be able to withdraw or move CNX across any supported chain.
- Per-chain token creation MUST NOT be treated as additional token supply.
- One `Primary L1` MUST be the single source of truth for real emission accounting and distribution.
- Every `Mirror L1` and every `Mirror L2` that has an emission contract MUST follow the same schedule in mirror mode.
- Startup cost accounting MUST be explicit, auditable, and consistent across chains.
- The system MUST support adding new chains after emission has already started.

## Core Model

Each integrated environment is technically independent at execution level, but all environments MUST follow one global CNX economy. Environment-local token mechanics MUST NOT be interpreted as independent token economies.

The global token economy MUST be defined by `Primary L1` real emission accounting.

- On `Primary L1`, DAO emission MUST be transferred to `DAO Treasury`, and node emission MUST be transferred to `Relay Wallet Cold`.
- Relay MUST settle node rewards in relay accounts first, and users MUST be able to choose the target chain for withdrawal from relay-managed inventory.
- A `Mirror L1` or `Mirror L2` that deploys an emission contract MUST execute mirror unlock using the same emission schedule.
- Mirror-unlocked CNX on `Mirror L1` and `Mirror L2` MUST be transferred to that environment's `Relay Wallet Cold` as cross-chain reserve inventory.
- Mirror inventory MUST NOT be treated as extra token supply.
- Only `Primary L1` MUST send DAO emission to `DAO Treasury`.

## L1 and L2 Topology Model

The Crynux production topology MUST support multiple L1 environments. Each L1 environment MUST have exactly one Crynux-operated L2 network attached to it. Node runtime contracts execute on L2, and CNX is the L2 native gas and settlement token.

L1 MUST deploy both a CNX token contract and an emission contract. When L1 is an EVM chain, the token and emission implementation MUST be the ERC-20 based version.

L2 MUST NOT deploy a separate token contract. L2 native token MUST always be CNX.

Whether an emission contract is deployed on L2 depends on whether native CNX bridging is supported from L1 to L2:

### Native bridging supported

If the selected L1-to-L2 stack natively supports bridging L1 CNX into L2 native CNX, emission MUST be deployed only on L1.

Because all L2 CNX in this model originates from L1, `Crynux Bridge` MUST actively execute L1-to-L2 CNX transfers to keep L2 relay inventory sufficiently funded for node withdrawals and user cross-chain withdrawals. This bridge synchronization MUST run continuously with emission progress and expected withdrawal demand while preserving L1+L2 total supply conservation.

In this native-bridge case, L1 and L2 token balances are one conserved pool across two locations:

```text
Total CNX on L1 + Total CNX on L2 = CNX total supply
```

### Native bridging not supported

If L1-to-L2 native bridging does not exist for CNX, L2 MUST deploy its own emission contract.

In this non-native-bridge case, L1 and L2 MUST be treated as two parallel independent chains for emission accounting, the L2 emission contract MUST release L2 native CNX, the L2 environment MUST prepare sufficient total native CNX supply and transfer locked emission-managed inventory to the L2 emission contract before release operations begin, and cross-chain CNX transfer between the two chains MUST be implemented through `Crynux Bridge`.

In this non-native-bridge case, the two chains keep independent total-supply targets:

```text
Total CNX on L1 = CNX total supply
Total CNX on L2 = CNX total supply
```

## Roles and Accounts

Each integrated environment MUST be treated as one L1+L2 pair. New-chain onboarding in this document means adding one new L1 and its attached L2 together.

Each L1+L2 integrated environment MUST define these emission-related roles and addresses:

- `Deployer Address`: receives chain-level initial token allocation for initialization and deployment steps.
- `L1 Emission Contract`: required. Holds locked supply and releases CNX by schedule and mode. Its role MUST be `Primary` only on `Primary L1`, and MUST be `Mirror` on each `Mirror L1`.
- `Mirror Emission Contract` (L2): optional. Required only when native CNX bridging from that L1 to its L2 is not present.
- `Relay Wallet Cold`: receives mirror inventory and relay-held system inventory.
- `Relay Wallet Hot Contract`: executes operational transfer and settlement transactions.
- `Relay Wallet Operator / Task/Node Tx Signer`: one shared account that pays gas for relay wallet, task, and node related transactions.
- `DAO Treasury`: receives DAO emission only on `Primary L1`.

## Primary vs Mirror Accounting

The key difference between `Primary L1` and mirror environments is accounting path, not schedule cadence.

- On `Primary L1`, the emission split MUST include real DAO allocation to `DAO Treasury`.
- On `Mirror L1` and `Mirror L2`, mirror emission MUST go to `Relay Wallet Cold` and MUST NOT be treated as DAO spendable funds.

## First Chain Deployment and Operation

The first deployed environment MUST be one EVM L1 and its attached L2 with native CNX bridging. The L1 in this first environment MUST be the initial `Primary L1`.

### Deployment Sequence

1. Deploy the first environment's L1 CNX token contract on EVM L1.
2. Deploy and initialize the L1 `EmissionERC20` contract in `Primary` mode, with `initCost` provided as a constructor deployment parameter.
3. Fund the L1 Primary emission contract with locked CNX inventory equal to `TotalSupply - initCost`.
4. Deploy the first environment's L2 network infrastructure.
5. Define the `initCost` split across designated L1 and L2 startup cost categories for first-environment deployment/setup.
6. Bridge sufficient CNX from L1 to L2 to fund L2 startup balances, including:
   - `Relay Wallet Operator` gas funding;
   - `Relay Wallet Cold` startup inventory;
   - deployment and operation balance required for L2 node-related contracts.
7. Deploy and initialize L2 node-operation contracts after L2 startup balances are funded.
8. Execute the first emission on `Primary L1` immediately.
9. After the first emission, bridge the required reserve amount from L1 to `Primary L2 Relay Wallet Cold` based on expected L2 withdrawal and cross-chain liquidity demand.

### First Emission Accounting

The first emission MUST convert the pre-mainnet issuance baseline into mainnet CNX accounting according to the emission schedule.

When first emission is executed:

- If DAO nominal share is `daoEmission`, the actual transfer to `DAO Treasury` MUST be `daoEmission - initCost`.
- `initCost` MUST be treated as already-spent DAO startup expense.
- `initCost` MUST NOT be counted again as an extra token-supply increment.

After first-environment activation (`Primary L1` + `Primary L2`), chain totals MUST follow the topology totals defined in `L1 and L2 Topology Model`.

The first emission accounting MUST include DAO startup expense handling, where `initCost` is treated as already spent and MUST NOT be counted again.

## Adding New Chains After Emission Starts

At any time after emission has started on `Primary L1`, a newly added environment (one L1 and its attached L2) MUST catch up to the current global state and MUST NOT restart from period 0.

### New Environment Initialization Sequence

`startupCost` is the startup budget funded by DAO and consumed during new-environment initialization.
`globalEmmitedAmount` is the cumulative CNX already emitted when the new environment is added.

### L1 Steps

1. Deploy the new environment's L1 CNX token contract.
2. Deploy the new L1 emission contract with:
   - `mode = Mirror`
   - `initCost = 0`
   - `initialEmissionIndex = current global emission progress`
3. Transfer `CNX total supply - globalEmmitedAmount` into the new L1 emission contract.
4. Transfer `globalEmmitedAmount - startupCost` to the new L1 `Relay Wallet Cold` as historical mirror inventory.
5. On `Primary L1`, transfer `startupCost` from `DAO Treasury` to `Primary L1 Relay Wallet Cold` to record DAO startup spend.

### L2 Steps

1. Determine whether native CNX bridging is supported from the new L1 to its L2.
2. If native CNX bridging is supported:
   - do not deploy an L2 mirror emission contract;
   - bridge `startupCost / 2` from the new L1 to the new L2 for L2-side startup spending.
3. If native CNX bridging is not supported:
   - use `startupCost / 2` on the new L1 for L1-side startup spending;
   - transfer `startupCost / 2` on the new L1 to the new L1 `Relay Wallet Cold` as the L1 accounting record for L2-side startup spending;
   - use `startupCost / 2` from the new L2 native CNX initial supply for L2-side deployment and operations;
   - deploy the L2 mirror emission contract with:
     - `mode = Mirror`
     - `initCost = 0`
     - `initialEmissionIndex = current global emission progress`
   - transfer `CNX total supply - globalEmmitedAmount` into the L2 mirror emission contract;
   - transfer `globalEmmitedAmount - startupCost / 2` to the new L2 `Relay Wallet Cold` as historical mirror inventory.
