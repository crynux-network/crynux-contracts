// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./BenefitAddress.sol";
import "./interfaces/IStakeObserver.sol";

contract NodeStaking is Ownable, ReentrancyGuard {
    using EnumerableSet for EnumerableSet.AddressSet;

    error OwnershipRenouncementDisabled();

    uint256 private minStakeAmount;
    uint256 private forceUnstakeDelay = 1800;

    enum StakingStatus {
        Unstaked,
        Staked,
        PendingUnstaked
    }

    struct StakingInfo {
        address nodeAddress;
        uint stakedBalance;
        StakingStatus status;
        uint unstakeTimestamp;
    }

    event NodeStaked(address indexed nodeAddress, uint stakedBalance);
    event NodeTryUnstaked(address indexed nodeAddress);
    event NodeUnstaked(address indexed nodeAddress, uint stakedBalance);
    event NodeSlashed(address indexed nodeAddress, uint stakedBalance);
    event AdminAddressUpdated(address indexed oldAddress, address indexed newAddress);
    event MinStakeAmountUpdated(uint256 oldAmount, uint256 newAmount);
    event ForceUnstakeDelayUpdated(uint256 oldDelay, uint256 newDelay);
    event ObserverUpdated(address indexed oldObserver, address indexed newObserver);

    // store all staking info
    EnumerableSet.AddressSet private allNodeAddresses;
    mapping(address => StakingInfo) private nodeStakingMap;

    BenefitAddress public immutable ba;
    address private adminAddress;
    address public immutable slashReceiver;
    IStakeObserver private observer;

    constructor(
        address benefitAddressContract,
        address slashReceiverAddress,
        uint256 minStakeAmount_
    ) Ownable(msg.sender) {
        require(benefitAddressContract != address(0), "benefit address is zero");
        require(slashReceiverAddress != address(0), "slash receiver is zero");
        require(minStakeAmount_ > 0, "minimum stake amount is 0");
        ba = BenefitAddress(benefitAddressContract);
        slashReceiver = slashReceiverAddress;
        minStakeAmount = minStakeAmount_;
    }

    function renounceOwnership() public view override onlyOwner {
        revert OwnershipRenouncementDisabled();
    }

    function setAdminAddress(address addr) external onlyOwner {
        require(addr != address(0), "admin address is zero");
        address oldAddress = adminAddress;
        adminAddress = addr;
        emit AdminAddressUpdated(oldAddress, addr);
    }

    function setMinStakeAmount(uint stakeAmount) public onlyOwner {
        require(stakeAmount > 0, "minimum stake amount is 0");
        uint oldAmount = minStakeAmount;
        minStakeAmount = stakeAmount;
        emit MinStakeAmountUpdated(oldAmount, stakeAmount);
    }

    function setForceUnstakeDelay(uint delay) public onlyOwner {
        require(delay > 0, "force unstake delay is 0");
        uint oldDelay = forceUnstakeDelay;
        forceUnstakeDelay = delay;
        emit ForceUnstakeDelayUpdated(oldDelay, delay);
    }

    function setObserver(address addr) external onlyOwner {
        require(
            addr == address(0) || addr.code.length > 0,
            "observer is not a contract"
        );
        address oldObserver = address(observer);
        observer = IStakeObserver(addr);
        emit ObserverUpdated(oldObserver, addr);
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

    function stake(uint stakedAmount) public payable nonReentrant {
        require(stakedAmount >= minStakeAmount, "Staked amount is too low");

        StakingInfo memory currentStakingInfo = nodeStakingMap[msg.sender];
        require(
            currentStakingInfo.status == StakingStatus.Unstaked ||
                currentStakingInfo.status == StakingStatus.Staked,
            "Wrong staking status"
        );
        uint currentStakedAmount = currentStakingInfo.stakedBalance;
        uint refundAmount = 0;

        if (currentStakedAmount < stakedAmount) {
            uint diff = stakedAmount - currentStakedAmount;
            require(msg.value == diff, "Inconsistent staked balance");
            nodeStakingMap[msg.sender].stakedBalance = stakedAmount;
        } else if (currentStakedAmount > stakedAmount) {
            require(msg.value == 0, "Inconsistent staked balance");
            refundAmount = currentStakedAmount - stakedAmount;
            nodeStakingMap[msg.sender].stakedBalance = stakedAmount;
        } else {
            require(msg.value == 0, "Inconsistent staked balance");
        }

        nodeStakingMap[msg.sender].nodeAddress = msg.sender;
        nodeStakingMap[msg.sender].status = StakingStatus.Staked;
        allNodeAddresses.add(msg.sender);
        emit NodeStaked(msg.sender, nodeStakingMap[msg.sender].stakedBalance);

        if (currentStakedAmount != stakedAmount) {
            _notifyStakeChanged(msg.sender);
        }
        if (refundAmount > 0) {
            returnBalance(msg.sender, refundAmount);
        }
    }

    function tryUnstake() public {
        _requireObserverConfigured();
        require(allNodeAddresses.contains(msg.sender), "Node not staked");
        require(
            nodeStakingMap[msg.sender].status == StakingStatus.Staked,
            "Node has unstaked"
        );
        nodeStakingMap[msg.sender].status = StakingStatus.PendingUnstaked;
        nodeStakingMap[msg.sender].unstakeTimestamp = block.timestamp;
        emit NodeTryUnstaked(msg.sender);
    }

    function forceUnstake() public nonReentrant {
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
    function unstake(address nodeAddress) public nonReentrant {
        require(msg.sender == adminAddress, "Not called by the admin");
        require(allNodeAddresses.contains(nodeAddress), "Node not staked");
        // status can be StakingStatus.Staked to support relay kick out node
        require(
            nodeStakingMap[nodeAddress].status == StakingStatus.PendingUnstaked || nodeStakingMap[nodeAddress].status == StakingStatus.Staked,
            "Wrong staking status"
        );
        _unstake(nodeAddress);
    }

    function slashStaking(address nodeAddress) public nonReentrant {
        require(msg.sender == adminAddress, "Not called by the admin");
        require(allNodeAddresses.contains(nodeAddress), "Node not staked");
        uint stakedBalance = nodeStakingMap[nodeAddress].stakedBalance;
        require(stakedBalance > 0, "Staking is zero");

        allNodeAddresses.remove(nodeAddress);
        delete nodeStakingMap[nodeAddress];
        emit NodeSlashed(nodeAddress, stakedBalance);
        _notifyStakeChanged(nodeAddress);

        if (stakedBalance > 0) {
            (bool success, ) = slashReceiver.call{value: stakedBalance}("");
            require(success, "Token transfer failed");
        }
    }

    function _unstake(address nodeAddress) internal {
        uint stakedBalance = nodeStakingMap[nodeAddress].stakedBalance;
        require(stakedBalance > 0, "Staking is zero");

        allNodeAddresses.remove(nodeAddress);
        delete nodeStakingMap[nodeAddress];
        emit NodeUnstaked(nodeAddress, stakedBalance);
        _notifyStakeChanged(nodeAddress);

        returnBalance(nodeAddress, stakedBalance);
    }

    function _notifyStakeChanged(address account) internal {
        _requireObserverConfigured();
        observer.onStakeChanged(account);
    }

    function _requireObserverConfigured() internal view {
        require(address(observer) != address(0), "observer not configured");
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
