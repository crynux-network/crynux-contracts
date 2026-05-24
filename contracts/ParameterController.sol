// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";

interface INodeStakingParameters {
    function setAdminAddress(address addr) external;

    function setMinStakeAmount(uint256 stakeAmount) external;

    function setForceUnstakeDelay(uint256 delay) external;
}

interface IDelegatedStakingParameters {
    function setMinStakeAmount(uint256 stakeAmount) external;
}

interface ICreditsParameters {
    function setAdminAddress(address addr) external;
}

contract ParameterController is Ownable {
    INodeStakingParameters private nodeStaking;
    IDelegatedStakingParameters private delegatedStaking;
    ICreditsParameters private credits;
    address private writer;

    event WriterUpdated(address indexed writerAddress);
    event NodeStakingAdminAddressUpdated(address indexed adminAddress);
    event NodeStakingMinStakeAmountUpdated(uint256 minStakeAmount);
    event NodeStakingForceUnstakeDelayUpdated(uint256 forceUnstakeDelay);
    event DelegatedStakingMinStakeAmountUpdated(uint256 minStakeAmount);
    event CreditsAdminAddressUpdated(address indexed adminAddress);

    modifier onlyWriter() {
        require(msg.sender == writer, "Not called by writer");
        _;
    }

    constructor(
        address nodeStakingAddress,
        address delegatedStakingAddress,
        address creditsAddress,
        address writerAddress
    ) Ownable(msg.sender) {
        require(nodeStakingAddress != address(0), "node staking is zero");
        require(
            delegatedStakingAddress != address(0),
            "delegated staking is zero"
        );
        require(creditsAddress != address(0), "credits is zero");
        require(writerAddress != address(0), "writer is zero");

        nodeStaking = INodeStakingParameters(nodeStakingAddress);
        delegatedStaking = IDelegatedStakingParameters(delegatedStakingAddress);
        credits = ICreditsParameters(creditsAddress);
        writer = writerAddress;
    }

    function setWriter(address writerAddress) external onlyOwner {
        require(writerAddress != address(0), "writer is zero");
        writer = writerAddress;
        emit WriterUpdated(writerAddress);
    }

    function setNodeStakingAdminAddress(address addr) external onlyWriter {
        nodeStaking.setAdminAddress(addr);
        emit NodeStakingAdminAddressUpdated(addr);
    }

    function setNodeStakingMinStakeAmount(uint256 amount) external onlyWriter {
        nodeStaking.setMinStakeAmount(amount);
        emit NodeStakingMinStakeAmountUpdated(amount);
    }

    function setNodeStakingForceUnstakeDelay(uint256 delay) external onlyWriter {
        nodeStaking.setForceUnstakeDelay(delay);
        emit NodeStakingForceUnstakeDelayUpdated(delay);
    }

    function setDelegatedStakingMinStakeAmount(
        uint256 amount
    ) external onlyWriter {
        delegatedStaking.setMinStakeAmount(amount);
        emit DelegatedStakingMinStakeAmountUpdated(amount);
    }

    function setCreditsAdminAddress(address addr) external onlyWriter {
        credits.setAdminAddress(addr);
        emit CreditsAdminAddressUpdated(addr);
    }
}
