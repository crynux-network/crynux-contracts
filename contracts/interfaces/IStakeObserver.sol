// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

interface IStakeObserver {
    function onStakeChanged(address account) external;
}
