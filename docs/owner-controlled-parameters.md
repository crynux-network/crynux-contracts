# Staking Parameter Authority

This document is the authority for initialization and modification rights in `NodeStaking`, `DelegatedStaking`, and `BenefitAddress`.

## Highest-Priority Rule

Owner MUST NOT be able to use any direct or indirect parameter change to send user funds already held by a contract to an address selected by Owner.

Every constructor parameter, stored address, external contract reference, authorization address, setter, and execution entry point MUST be classified by its complete call path. Classification MUST include every external contract behavior that determines a receiver, balance, amount, ownership right, transfer approval, or execution target. Matching an interface MUST NOT be treated as proof that a replacement contract preserves fund behavior.

Classification MUST be performed in R1, R2, R3, R4 order. A value that satisfies R1 MUST remain R1.

## Classification Rules

### R1: Existing User Funds

A value or entry point is R1 when changing it can directly or indirectly:

- change the final receiver of user funds already held by a contract;
- change refund, slash, transfer amount, user balance, fund ownership, or transfer authorization calculations;
- bypass the defined refund, slash, or balance rules; or
- provide arbitrary `call`, `delegatecall`, token approval, withdrawal, rescue, implementation replacement, or another general fund execution path.

R1 values MUST be fixed at deployment and MUST NOT have an Owner setter.

### R2: Non-Fund Contract Bindings

A contract binding is R2 only when it is used for notification or non-fund state, replacement cannot change fund receivers, balances, ownership, or approvals, and calls send no funds.

Every R2 binding MUST have an `onlyOwner` setter because observer contracts require replacement and pausing. The setter MUST validate the supported input and emit old and new values. Callback entry points MUST have reentrancy protection.

An incorrect or malicious observer can revert staking transactions. A zero observer MUST pause every operation that changes a stake amount and `NodeStaking.tryUnstake`, because `tryUnstake` starts the Relay or force-unstake flow that later removes stake. The observer cannot receive staking funds through the callback.

### R3: Runtime Parameters and Fixed Operation Authorization

A value is R3 when it controls a number, time, or runtime signer without deciding an existing fund receiver and without providing arbitrary execution.

Every R3 value MUST have an `onlyOwner` setter, input validation, and an event containing old and new values.

An authorized runtime signer MUST be limited to contract-defined operations. It MUST NOT supply an arbitrary receiver or arbitrary call data.

### R4: User State and User Configuration

Stake balances, stake status, timestamps, delegation relationships, delegator share, and benefit-address choices are R4.

Owner MUST NOT have a setter that directly writes or replaces R4 data. R4 state MUST change only through the user actions and fixed Relay operations specified below.

## Common Ownership Constraints

The deployer MUST initially be Owner of both staking contracts. After both observers are configured, ownership MUST transfer to `CouncilGovernor`.

Ownership transfer MUST NOT change the R1 through R4 classification. Owner MUST NOT receive an arbitrary withdrawal, rescue, external-call, implementation-replacement, proxy-upgrade, stake-balance write, delegator-share write, or benefit-address write method.

Every new constructor parameter, stored address, setter, or management entry point MUST be added to this document before implementation. Its complete call path, classification, fund effect, Owner-compromise result, and final authority MUST be specified.

## R1 Fixed Values

### `NodeStaking.ba`

- Initialization: constructor argument `benefitAddressContract`.
- Validation: MUST be nonzero.
- Modification: MUST NOT be modifiable after deployment.
- Call path: `NodeStaking.returnBalance` calls `ba.getBenefitAddress(node)` and sends unstaked native CNX to the returned address or the node when the result is zero.
- Business reason: this contract determines the final receiver of held node stake.
- Fund effect: replacement could redirect existing node refunds.
- Owner compromise: the attacker cannot replace the payout resolver or redirect held stake through an Owner setter.

### `NodeStaking.slashReceiver`

- Initialization: constructor argument `slashReceiverAddress`.
- Validation: MUST be nonzero.
- Modification: MUST NOT be modifiable after deployment.
- Call path: `slashStaking` sends the complete slashed native CNX balance to this address.
- Business reason: the slash destination is part of the fixed fund flow.
- Fund effect: it directly receives held node stake after slash.
- Owner compromise: the attacker can trigger the fixed slash flow after replacing `adminAddress`, but cannot select a new receiver.

### `DelegatedStaking.slashReceiver`

- Initialization: constructor argument `slashReceiverAddress`.
- Validation: MUST be nonzero.
- Modification: MUST NOT be modifiable after deployment.
- Call path: `slashNodeDelegations` totals removed delegation balances and sends that native CNX to this address.
- Business reason: the delegated slash destination is part of the fixed fund flow.
- Fund effect: it directly receives held delegated stake after slash.
- Owner compromise: the attacker can trigger the fixed slash flow after replacing `adminAddress`, but cannot select a new receiver.

## R2 Observer Bindings

### `NodeStaking.observer`

- Initialization: zero address.
- Modification: `setObserver(address)` by Owner.
- Validation: zero MUST be accepted to pause stake-amount changes; a nonzero address MUST contain contract code and MUST be called as `IStakeObserver`.
- Event: `ObserverUpdated(oldObserver,newObserver)`.
- Call path: changed node stake storage, required observer notification, then native CNX refund or slash transfer. A zero observer MUST revert and roll back the stake change.
- Business reason: `CouncilRegistry` requires node voting-balance updates and is deployed after staking addresses exist.
- Fund effect: the callback sends no funds and does not determine a receiver or amount.
- Owner compromise: the attacker can pause stake-amount changes by clearing the observer or install an observer that reverts staking operations. The observer cannot receive staking funds through this binding.

### `DelegatedStaking.observer`

- Initialization, modification, validation, and event: identical to `NodeStaking.observer`.
- Call path: changed delegator storage, required observer notification for each affected delegator, then native CNX refund or batch slash transfer. A zero observer MUST revert and roll back the stake change.
- Business reason: `CouncilRegistry` requires delegator voting-balance updates.
- Fund effect: the callback sends no funds and does not determine a receiver or amount.
- Owner compromise: the attacker can pause stake-amount changes by clearing the observer or install an observer that reverts staking operations. The observer cannot receive staking funds through this binding.

## R3 Runtime Values

### `NodeStaking.adminAddress`

- Initialization: set by deployer after construction.
- Modification: `setAdminAddress(address)` by Owner.
- Validation: MUST be nonzero.
- Event: `AdminAddressUpdated(oldAddress,newAddress)`.
- Authorized operations: `unstake(address)` and `slashStaking(address)`.
- Fund effect: unstake follows the fixed BenefitAddress lookup; slash follows the fixed slash receiver.
- Owner compromise: the attacker can authorize an address to force unstake or slash nodes. Funds cannot enter an address selected by the attacker unless that address was already the user's fixed benefit address or deployment-fixed slash receiver.

### `NodeStaking.minStakeAmount`

- Initialization: constructor argument `minStakeAmount_`.
- Modification: `setMinStakeAmount(uint256)` by Owner.
- Validation: MUST be greater than zero.
- Event: `MinStakeAmountUpdated(oldAmount,newAmount)`.
- Fund effect: controls accepted target stake amounts and does not select a receiver.
- Owner compromise: the attacker can interfere with new staking and stake adjustments but cannot redirect held funds.

### `NodeStaking.forceUnstakeDelay`

- Initialization: contract default `1800` seconds, then explicit deployment parameter.
- Modification: `setForceUnstakeDelay(uint256)` by Owner.
- Validation: MUST be greater than zero.
- Event: `ForceUnstakeDelayUpdated(oldDelay,newDelay)`.
- Fund effect: controls when a pending node can call `forceUnstake` and does not select a receiver.
- Owner compromise: the attacker can change user exit timing but cannot redirect held funds.

### `DelegatedStaking.adminAddress`

- Initialization: set by deployer after construction.
- Modification: `setAdminAddress(address)` by Owner.
- Validation: MUST be nonzero.
- Event: `AdminAddressUpdated(oldAddress,newAddress)`.
- Authorized operation: `slashNodeDelegations(address,address[])`.
- Fund effect: slash funds use the deployment-fixed receiver.
- Owner compromise: the attacker can authorize delegated slashes but cannot select their receiver.

### `DelegatedStaking.minStakeAmount`

- Initialization: constructor argument `minStakeAmount_`.
- Modification: `setMinStakeAmount(uint256)` by Owner.
- Validation: MUST be greater than zero.
- Event: `MinStakeAmountUpdated(oldAmount,newAmount)`.
- Fund effect: controls accepted delegation target amounts and does not select a receiver.
- Owner compromise: the attacker can interfere with new delegations and adjustments but cannot redirect held funds.

### `Ownable.owner`

- Initialization: deployer through each staking constructor.
- Modification: standard `transferOwnership(address)` by current Owner.
- Validation: OpenZeppelin Ownable MUST reject zero-address ownership transfer.
- Renouncement: both staking contracts MUST override `renounceOwnership()` and MUST revert, so ownership cannot become the zero address.
- Event: standard `OwnershipTransferred`.
- Business reason: Owner controls only R2 and R3 setters and later transfers authority to `CouncilGovernor`.
- Fund effect: ownership MUST NOT expose R1 replacement or arbitrary fund execution.
- Owner compromise: the attacker gains the R2 and R3 effects listed above and no additional fund receiver.

## R4 User State and Configuration

### `NodeStaking` stake state

- Values: `stakedBalance`, `status`, and `unstakeTimestamp`.
- Initialization: empty mapping state.
- Modification: node `stake`, `tryUnstake`, and `forceUnstake`; Relay-admin fixed `unstake` and `slashStaking`.
- Input limits: stake target MUST meet `minStakeAmount`; increases MUST supply exactly the native CNX difference; decreases MUST supply zero; `tryUnstake` and every amount change MUST require a nonzero observer; force unstake MUST follow pending status and delay.
- Owner authority: Owner MUST NOT write these values directly.
- Fund effect: unstake refunds through fixed BenefitAddress logic; slash sends funds to fixed `slashReceiver`.
- Owner compromise: the attacker can act only through a configured admin and the fixed flows.

### `DelegatedStaking` delegation state

- Values: pair balances, delegator totals, node totals, and delegator/node indexes.
- Initialization: empty mapping and set state.
- Modification: delegator `stake` and `unstake`; Relay-admin `slashNodeDelegations`.
- Input limits: target amount MUST meet `minStakeAmount`; increases MUST supply exactly the native CNX difference; decreases MUST supply zero; every amount change MUST require a nonzero observer.
- Owner authority: Owner MUST NOT write these values directly.
- Fund effect: unstake returns to the delegator; slash sends to fixed `slashReceiver`.
- Owner compromise: the attacker can act only through a configured admin and the fixed slash flow.

### `DelegatedStaking.nodeDelegatorShare`

- Initialization: zero for each node.
- Modification: `setDelegatorShare(uint8)` by the node itself.
- Validation: MUST be less than `100`; zero removes the node from the available-node set.
- Owner authority: Owner MUST NOT set or replace a node's share.
- Fund effect: share does not transfer held staking funds.
- Owner compromise: the attacker cannot write this value through Owner authority.

### `BenefitAddress` user binding

- Initialization: empty for each node.
- Modification: `setBenefitAddress(address)` once by the node itself.
- Validation: MUST be nonzero and MUST reject a second setting.
- Owner authority: Owner MUST NOT set, replace, or clear a node's benefit address.
- Fund effect: the binding becomes the receiver for later node unstake refunds.
- Owner compromise: the attacker cannot change existing or unset user bindings through Owner authority.
