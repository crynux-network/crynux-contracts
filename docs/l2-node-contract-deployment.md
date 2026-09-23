# L2 Node Contract Deployment

This document specifies the active L2 contract relationships, deployment parameters, and governance handoff.

## Contract Scope and Relationships

The active non-token Relay integration contracts MUST be:

| Contract | Responsibility |
|----------|----------------|
| `BenefitAddress.sol` | Store each node's one-time payout address binding |
| `NodeStaking.sol` | Store native CNX operator stake and execute Relay-authorized unstake and slash |
| `DelegatedStaking.sol` | Store native CNX delegated stake and execute Relay-authorized delegated slash |

`NodeStaking` MUST receive `BenefitAddress`, `slashReceiver`, and `minStakeAmount_` in its constructor. `BenefitAddress` and `slashReceiver` MUST remain fixed after deployment. `minStakeAmount_` initializes the R3 minimum stake and MAY later change through `setMinStakeAmount`.

`DelegatedStaking` MUST receive `slashReceiver` and `minStakeAmount_` in its constructor. `slashReceiver` MUST remain fixed after deployment. `minStakeAmount_` initializes the R3 minimum stake and MAY later change through `setMinStakeAmount`.

`NodeStaking` MUST read `BenefitAddress.getBenefitAddress(address)` before returning native CNX. It MUST send the return to the configured benefit address or to the node address when no benefit address is configured.

`NodeStaking` and `DelegatedStaking` MUST NOT call each other during slash. Relay MUST execute operator slash and delegated slash as separate fixed operations.

Node staking MUST use native CNX only. The requested target amount MUST equal the existing native stake plus `msg.value` for an increase. A decrease MUST use zero `msg.value`.

## Initial Deployment

The deployment parameter file MUST use this shape:

```json
{
    "DeployNodeContracts": {
        "relayOperatorAddress": "0x000000000000000000000000000000000000dEaD",
        "slashReceiverAddress": "0x000000000000000000000000000000000000FEE1",
        "nodeMinStakeAmount": "400000000000000000000",
        "delegatedMinStakeAmount": "400000000000000000000",
        "forceUnstakeDelay": 1800
    }
}
```

`relayOperatorAddress` and `slashReceiverAddress` MUST be nonzero.

`nodeMinStakeAmount`, `delegatedMinStakeAmount`, and `forceUnstakeDelay` MUST be positive. Crynux on Base testnet and Crynux on RH Testnet configs MUST use `400e18` for both minimum stake amounts. Crynux on Base and Crynux on RH mainnet configs MUST use `100000e18` for both minimum stake amounts. Every Crynux on RH environment MUST use the same-environment Crynux on Base Relay operator, fixed slash receiver, and `1800`-second force-unstake delay. The Ignition module default for both minimum stake amounts MUST be `400e18`. The Ignition module default for `forceUnstakeDelay` MUST be `1800` seconds.

Crynux on RH MUST use chain ID `18896215`. Crynux on RH Testnet MUST use chain ID `188962150`. Node contracts on these chains MUST use native CNX and MUST follow the same deployment order, runtime authority, observer configuration, and governance handoff defined in this document.

The module MUST deploy contracts in this order:

1. Deploy `BenefitAddress`.
2. Deploy `DelegatedStaking` with the fixed slash receiver and `delegatedMinStakeAmount`.
3. Deploy `NodeStaking` with the fixed BenefitAddress, slash receiver, and `nodeMinStakeAmount`.
4. Set both `adminAddress` values to `relayOperatorAddress`.
5. Set the force-unstake delay on `NodeStaking`.

The deployer MUST be the initial Owner of both staking contracts. Both observers MUST initially be zero because `CouncilRegistry` requires the staking addresses in its constructor. Until the corresponding observer is set to a nonzero contract, every operation that changes a stake amount MUST revert. `NodeStaking.tryUnstake` MUST also revert because it starts the later Relay or force-unstake flow.

New deployments MUST use a deployment ID that does not reuse the historical Credits and ParameterController journal. New deployment output MUST contain only `benefitAddress`, `nodeStaking`, `delegatedStaking`, and the deployment block number. Existing `contracts.json` records containing Credits and ParameterController MUST remain unchanged as historical records.

## Runtime Authority

`relayOperatorAddress` MUST be authorized only for:

- `NodeStaking.unstake(address)`
- `NodeStaking.slashStaking(address)`
- `DelegatedStaking.slashNodeDelegations(address,address[])`

The Relay signer MUST NOT select a refund receiver or slash receiver. Node refunds MUST follow the fixed BenefitAddress lookup. Slash funds MUST use the constructor-fixed receiver.

Owner MUST be authorized only for the staking setters listed in `owner-controlled-parameters.md` and standard ownership transfer. The staking contracts MUST NOT expose arbitrary withdrawal, rescue, external-call, implementation-replacement, or proxy-upgrade methods.

## Governance Configuration

After `CouncilRegistry` and `CouncilGovernor` are deployed, the current staking Owner MUST:

1. Verify `NodeStaking.ba` equals the deployed BenefitAddress.
2. Verify both `slashReceiver` values equal the deployment parameter.
3. Verify both `owner` values equal the account executing the configuration.
4. Set both observers to `CouncilRegistry`.
5. Transfer both ownerships to `CouncilGovernor`.

The post-deployment parameter file MUST use this shape:

```json
{
    "ConfigureGovernedStaking": {
        "nodeStakingAddress": "0x0000000000000000000000000000000000000001",
        "delegatedStakingAddress": "0x0000000000000000000000000000000000000002",
        "councilRegistryAddress": "0x0000000000000000000000000000000000000003",
        "councilGovernorAddress": "0x0000000000000000000000000000000000000004"
    }
}
```

The observer calls MUST occur after staking storage updates and before native CNX transfers. A zero or reverting observer MUST revert the complete amount-changing staking operation. Setting an observer to zero MUST pause stake-amount changes and `NodeStaking.tryUnstake` until a new nonzero observer is configured. Reentrancy protection MUST cover every staking entry point that invokes an observer.

## Deployment Boundary

Existing mainnet and testnet contracts are non-proxy contracts and MUST NOT change in place. The current implementation MUST be enabled only through deployment at new addresses.

This deployment SHALL NOT migrate existing stake or change Relay, Admin, Portal, governance-contracts, or other repository integrations.
