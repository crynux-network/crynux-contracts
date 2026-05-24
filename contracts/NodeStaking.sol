// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./Credits.sol";
import "./BenefitAddress.sol";
import "./DelegatedStaking.sol";
import "./ParameterControlled.sol";

contract NodeStaking is ParameterControlled {
    using EnumerableSet for EnumerableSet.AddressSet;

    uint256 private minStakeAmount = 400 * 10 ** 18;
    uint256 private forceUnstakeDelay = 1800;

    enum StakingStatus {
        Unstaked,
        Staked,
        PendingUnstaked
    }

    struct StakingInfo {
        address nodeAddress;
        uint stakedBalance;
        uint stakedCredits;
        StakingStatus status;
        uint unstakeTimestamp;
    }

    event NodeStaked(
        address indexed nodeAddress,
        uint stakedBalance,
        uint stakedCredits
    );
    event NodeTryUnstaked(address indexed nodeAddress);
    event NodeUnstaked(
        address indexed nodeAddress,
        uint stakedBalance,
        uint stakedCredits
    );
    event NodeSlashed(
        address indexed nodeAddress,
        uint stakedBalance,
        uint stakedCredits
    );

    // store all staking info
    EnumerableSet.AddressSet private allNodeAddresses;
    mapping(address => StakingInfo) private nodeStakingMap;

    Credits private credits;
    BenefitAddress private ba;
    DelegatedStaking private ds;

    address private adminAddress;
    address private immutable slashReceiver;

    constructor(
        address creditsContract,
        address benefitAddressContract,
        address delegatedStakingContract,
        address slashReceiverAddress
    ) {
        require(slashReceiverAddress != address(0), "slash receiver is zero");
        credits = Credits(creditsContract);
        ba = BenefitAddress(benefitAddressContract);
        ds = DelegatedStaking(delegatedStakingContract);
        slashReceiver = slashReceiverAddress;
    }

    function setAdminAddress(address addr) external onlyParameterController {
        adminAddress = addr;
    }

    function setMinStakeAmount(uint stakeAmount) public onlyParameterController {
        require(stakeAmount > 0, "minimum stake amount is 0");
        minStakeAmount = stakeAmount;
    }

    function setForceUnstakeDelay(uint delay) public onlyParameterController {
        require(delay > 0, "force unstake delay is 0");
        forceUnstakeDelay = delay;
    }

    // public api for node
    function getMinStakeAmount() public view returns (uint) {
        return minStakeAmount;
    }

    function getForceUnstakeDelay() public view returns (uint256) {
        return forceUnstakeDelay;
    }

    function getStakingInfo(
        address nodeAddress
    ) public view returns (StakingInfo memory) {
        return nodeStakingMap[nodeAddress];
    }

    function getAllNodeAddresses(
        uint256 page,
        uint256 pageSize
    ) public view returns (address[] memory) {
        require(page > 0, "page is 0");
        require(pageSize > 0 && pageSize <= 200, "invalid page size");

        uint256 total = allNodeAddresses.length();
        uint256 start = (page - 1) * pageSize;
        if (start >= total) {
            return new address[](0);
        }

        uint256 end = start + pageSize;
        if (end > total) {
            end = total;
        }

        address[] memory nodes = new address[](end - start);
        for (uint256 i = 0; i < nodes.length; i++) {
            nodes[i] = allNodeAddresses.at(start + i);
        }
        return nodes;
    }

    function stake(uint stakedAmount) public payable {
        require(stakedAmount >= minStakeAmount, "Staked amount is too low");

        StakingInfo memory currentStakingInfo = nodeStakingMap[msg.sender];
        require(
            currentStakingInfo.status == StakingStatus.Unstaked ||
                currentStakingInfo.status == StakingStatus.Staked,
            "Wrong staking status"
        );
        uint currentStakedAmount = currentStakingInfo.stakedBalance +
            currentStakingInfo.stakedCredits;

        if (currentStakedAmount < stakedAmount) {
            uint stakedBalance = 0;
            uint stakedCredits = 0;
            uint diff = stakedAmount - currentStakedAmount;
            uint stakableCredits = credits.getCredits(msg.sender);
            if (diff <= stakableCredits) {
                stakedCredits = diff;
                stakedBalance = 0;
            } else {
                stakedCredits = stakableCredits;
                stakedBalance = diff - stakableCredits;
            }
            require(msg.value == stakedBalance, "Inconsistent staked balance");
            credits.stakeCredits(msg.sender, stakedCredits);
            nodeStakingMap[msg.sender].stakedBalance += stakedBalance;
            nodeStakingMap[msg.sender].stakedCredits += stakedCredits;
        } else if (currentStakedAmount > stakedAmount) {
            require(msg.value == 0, "Inconsistent staked balance");
            uint diff = currentStakedAmount - stakedAmount;
            if (diff <= currentStakingInfo.stakedBalance) {
                nodeStakingMap[msg.sender].stakedBalance -= diff;
                // return the staked balance
                returnBalance(msg.sender, diff);
            } else {
                nodeStakingMap[msg.sender].stakedBalance = 0;
                nodeStakingMap[msg.sender].stakedCredits = stakedAmount;
                // return the staked balance
                if (currentStakingInfo.stakedBalance > 0) {
                    returnBalance(msg.sender, currentStakingInfo.stakedBalance);
                }
                // return the staked credits
                uint creditsDiff = diff - currentStakingInfo.stakedBalance;
                credits.unstakeCredits(msg.sender, creditsDiff);
            }
        } else {
            require(msg.value == 0, "Inconsistent staked balance");
        }

        nodeStakingMap[msg.sender].nodeAddress = msg.sender;
        nodeStakingMap[msg.sender].status = StakingStatus.Staked;
        allNodeAddresses.add(msg.sender);
        emit NodeStaked(
            msg.sender,
            nodeStakingMap[msg.sender].stakedBalance,
            nodeStakingMap[msg.sender].stakedCredits
        );
    }

    function tryUnstake() public {
        require(allNodeAddresses.contains(msg.sender), "Node not staked");
        require(
            nodeStakingMap[msg.sender].status == StakingStatus.Staked,
            "Node has unstaked"
        );
        nodeStakingMap[msg.sender].status = StakingStatus.PendingUnstaked;
        nodeStakingMap[msg.sender].unstakeTimestamp = block.timestamp;
        emit NodeTryUnstaked(msg.sender);
    }

    function forceUnstake() public {
        require(allNodeAddresses.contains(msg.sender), "Node not staked");
        require(
            nodeStakingMap[msg.sender].status == StakingStatus.PendingUnstaked,
            "Node didn't tryUnstake first"
        );
        require(
            nodeStakingMap[msg.sender].unstakeTimestamp + forceUnstakeDelay <
                block.timestamp,
            "Force unstake time not reached"
        );
        _unstake(msg.sender);
    }

    // public api for admin
    function unstake(address nodeAddress) public {
        require(msg.sender == adminAddress, "Not called by the admin");
        require(allNodeAddresses.contains(nodeAddress), "Node not staked");
        // status can be StakingStatus.Staked to support relay kick out node
        require(
            nodeStakingMap[nodeAddress].status == StakingStatus.PendingUnstaked || nodeStakingMap[nodeAddress].status == StakingStatus.Staked,
            "Wrong staking status"
        );
        _unstake(nodeAddress);
    }

    function slashStaking(address nodeAddress) public {
        require(msg.sender == adminAddress, "Not called by the admin");
        require(allNodeAddresses.contains(nodeAddress), "Node not staked");
        uint stakedBalance = nodeStakingMap[nodeAddress].stakedBalance;
        uint stakedCredits = nodeStakingMap[nodeAddress].stakedCredits;
        uint stakeAmount = stakedBalance + stakedCredits;
        require(stakeAmount > 0, "Staking is zero");
        if (stakedBalance > 0) {
            require(slashReceiver != address(0), "slash receiver not set");
            (bool success, ) = slashReceiver.call{value: stakedBalance}("");
            require(success, "Token transfer failed");
        }
        ds.slashNode(nodeAddress);
        // remove node
        allNodeAddresses.remove(nodeAddress);
        delete nodeStakingMap[nodeAddress];
        emit NodeSlashed(nodeAddress, stakedBalance, stakedCredits);
    }

    function _unstake(address nodeAddress) internal {
        uint stakedBalance = nodeStakingMap[nodeAddress].stakedBalance;
        uint stakedCredits = nodeStakingMap[nodeAddress].stakedCredits;
        uint stakeAmount = stakedBalance + stakedCredits;
        require(stakeAmount > 0, "Staking is zero");

        // Return the staked balance
        if (stakedBalance > 0) {
            nodeStakingMap[nodeAddress].stakedBalance = 0;
            returnBalance(nodeAddress, stakedBalance);
        }

        // Return the credits
        if (stakedCredits > 0) {
            credits.unstakeCredits(nodeAddress, stakedCredits);
        }

        // remove node
        allNodeAddresses.remove(nodeAddress);
        delete nodeStakingMap[nodeAddress];
        emit NodeUnstaked(nodeAddress, stakedBalance, stakedCredits);
    }

    function returnBalance(address nodeAddress, uint amount) internal {
        require(amount > 0, "Amount is zero");
        address benefitAddress = ba.getBenefitAddress(nodeAddress);
        if (benefitAddress == address(0)) {
            benefitAddress = nodeAddress;
        }
        (bool success, ) = benefitAddress.call{value: amount}("");
        require(success, "Token transfer failed");
    }
}
