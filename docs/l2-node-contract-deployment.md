# L2 Node Contract Relationships

This document specifies the active L2 contract relationships and authority addresses required by Crynux node operation.

## Contract Scope

The active non-token Relay integration contracts on L2 MUST be:

| Contract | Responsibility |
|----------|----------------|
| `Credits.sol` | MUST store bootstrap staking credits and enforce that only the configured staking contract can move credits into or out of staking. |
| `BenefitAddress.sol` | MUST store immutable node payout address bindings. |
| `DelegatedStaking.sol` | MUST store delegated staking state, node delegator shares, and delegated-stake slash handling. |
| `NodeStaking.sol` | MUST store operator staking state and execute Relay-authorized operator unstake and slash actions. |

`CrynuxToken.sol` is outside the L2 node contract relationship scope. Token deployment belongs to the separate token flow.

The legacy task consensus contracts listed as legacy in `contract-roles-and-status.md` MUST NOT be part of the active L2 node contract relationship set.

## Contract Relationships

`NodeStaking` MUST reference:

- `Credits`
- `BenefitAddress`
- `DelegatedStaking`

`Credits` MUST reference `NodeStaking` as its staking contract.

`DelegatedStaking` MUST reference `NodeStaking` as its node staking contract.

`NodeStaking` MUST call `Credits.stakeCredits(address,uint256)` when bootstrap credits are moved into operator staking.

`NodeStaking` MUST call `Credits.unstakeCredits(address,uint256)` when staked credits are returned during operator unstake.

`NodeStaking` MUST read `BenefitAddress.getBenefitAddress(address)` before returning staked native balance. When a node has a configured benefit address, the returned native balance MUST be sent to that benefit address. When no benefit address is configured, the returned native balance MUST be sent to the node address.

`NodeStaking` MUST call `DelegatedStaking.slashNode(address)` when a node is slashed, so delegated staking state for that node is cleared through the delegated staking contract.

## Authority Addresses

The deployer account MUST become the owner of `Credits`, `BenefitAddress`, `DelegatedStaking`, and `NodeStaking` at deployment time.

`relayAdminAddress` MUST be the address that signs Relay runtime transactions for `NodeStaking`. This address is authorized to call:

- `NodeStaking.unstake(address)`
- `NodeStaking.slashStaking(address)`

`creditsAdminAddress` MUST be the address that signs bootstrap credit issuance transactions for `Credits`. This address is authorized to call:

- `Credits.createCredits(address,uint256)`

`creditsAdminAddress` is not required by the Relay runtime staking and slashing flow unless Relay also signs bootstrap credit issuance transactions.

`NodeStaking` MUST be the `stakingAddress` configured in `Credits`. This contract address is authorized to call:

- `Credits.stakeCredits(address,uint256)`
- `Credits.unstakeCredits(address,uint256)`

`NodeStaking` MUST be the `nodeStakingAddress` configured in `DelegatedStaking`. This contract address is authorized to call:

- `DelegatedStaking.slashNode(address)`

Relay blockchain configuration MUST reference `BenefitAddress`, `Credits`, and `NodeStaking` for the corresponding L2 network.
