// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "../interfaces/IStakeObserver.sol";

interface INodeStakingView {
    struct StakingInfo {
        address nodeAddress;
        uint256 stakedBalance;
        uint8 status;
        uint256 unstakeTimestamp;
    }

    function getStakingInfo(
        address nodeAddress
    ) external view returns (StakingInfo memory);
}

interface IDelegatedStakingView {
    function getDelegatorTotalStakeAmount(
        address delegatorAddress
    ) external view returns (uint256);
}

contract MockStakeObserver is IStakeObserver {
    address[] private callers;
    address[] private accounts;
    bool public shouldRevert;
    bool public checkNodeBalance;
    bool public checkDelegatedBalance;
    uint256 public expectedBalance;
    bytes public reentryCall;
    bool public reentrySucceeded;

    function configureStateCheck(
        bool nodeBalance,
        bool delegatedBalance,
        uint256 balance
    ) external {
        checkNodeBalance = nodeBalance;
        checkDelegatedBalance = delegatedBalance;
        expectedBalance = balance;
    }

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function setReentryCall(bytes calldata callData) external {
        reentryCall = callData;
    }

    function onStakeChanged(address account) external {
        require(!shouldRevert, "observer reverted");

        if (checkNodeBalance) {
            require(
                INodeStakingView(msg.sender)
                    .getStakingInfo(account)
                    .stakedBalance == expectedBalance,
                "unexpected node balance"
            );
        }
        if (checkDelegatedBalance) {
            require(
                IDelegatedStakingView(msg.sender)
                    .getDelegatorTotalStakeAmount(account) == expectedBalance,
                "unexpected delegated balance"
            );
        }

        callers.push(msg.sender);
        accounts.push(account);

        if (reentryCall.length > 0) {
            (reentrySucceeded, ) = msg.sender.call(reentryCall);
        }
    }

    function getCallCount() external view returns (uint256) {
        return accounts.length;
    }

    function getCall(
        uint256 index
    ) external view returns (address caller, address account) {
        return (callers[index], accounts[index]);
    }
}
