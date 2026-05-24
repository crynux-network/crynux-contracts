// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";

abstract contract ParameterControlled is Ownable {
    address private parameterController;

    event ParameterControllerUpdated(address indexed parameterControllerAddress);

    modifier onlyParameterController() {
        require(
            msg.sender == parameterController,
            "Not called by parameter controller"
        );
        _;
    }

    constructor() Ownable(msg.sender) {}

    function setParameterController(address addr) external onlyOwner {
        require(
            parameterController == address(0),
            "Parameter controller already set"
        );
        require(addr != address(0), "Parameter controller cannot be zero");
        parameterController = addr;
        emit ParameterControllerUpdated(addr);
    }
}
