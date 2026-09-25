// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "./interfaces/IStakeObserver.sol";

contract NoOpStakeObserver is IStakeObserver {
    function onStakeChanged(address) external {}
}
