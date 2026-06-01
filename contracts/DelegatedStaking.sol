// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./ParameterControlled.sol";

contract DelegatedStaking is ParameterControlled {
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;

    struct StakingInfo {
        address delegatorAddress;
        address nodeAddress;
        uint stakeAmount;
    }

    event DelegatorStaked(
        address indexed delegatorAddress,
        address nodeAddress,
        uint amount
    );
    event DelegatorUnstaked(
        address indexed delegatorAddress,
        address nodeAddress,
        uint amount
    );
    event DelegatorSlashed(
        address indexed delegatorAddress,
        address nodeAddress,
        uint amount
    );
    event NodeDelegatorShareChanged(address indexed nodeAddress, uint8 share);

    EnumerableSet.AddressSet private availableNodes;
    mapping(address => uint8) private nodeDelegatorShare;

    mapping(bytes32 => StakingInfo) private stakingInfos;
    EnumerableSet.AddressSet private delegatorAddresses;
    mapping(address => EnumerableSet.Bytes32Set) private userIndex;
    EnumerableSet.AddressSet private nodeAddresses;
    mapping(address => EnumerableSet.Bytes32Set) private nodeIndex;

    mapping(address => uint) private nodeStakeAmount;
    mapping(address => uint) private delegatorStakeAmount;

    uint private minStakeAmount = 400 * 10 ** 18;

    address private adminAddress;
    address private immutable slashReceiver;

    constructor(address slashReceiverAddress) {
        require(slashReceiverAddress != address(0), "slash receiver is zero");
        slashReceiver = slashReceiverAddress;
    }

    function setMinStakeAmount(
        uint stakeAmount
    ) public onlyParameterController {
        require(stakeAmount > 0, "minimum stake amount is 0");
        minStakeAmount = stakeAmount;
    }

    function getMinStakeAmount() public view returns (uint) {
        return minStakeAmount;
    }

    function setAdminAddress(address addr) external onlyParameterController {
        require(addr != address(0), "admin address is zero");
        adminAddress = addr;
    }

    function setDelegatorShare(uint8 share) public {
        require(share < 100, "share is larger than 100");
        nodeDelegatorShare[msg.sender] = share;
        emit NodeDelegatorShareChanged(msg.sender, share);
        if (share == 0) {
            availableNodes.remove(msg.sender);
        } else {
            availableNodes.add(msg.sender);
        }
    }

    function stake(address nodeAddress, uint amount) public payable {
        require(
            nodeDelegatorShare[nodeAddress] > 0,
            "node delegator share is 0"
        );
        require(amount >= minStakeAmount, "stake amount is too low");

        bytes32 stakingInfoID = keccak256(
            abi.encodePacked(msg.sender, nodeAddress)
        );
        uint oldAmount = stakingInfos[stakingInfoID].stakeAmount;
        require(
            (amount > oldAmount && msg.value == amount - oldAmount) ||
                (amount <= oldAmount && msg.value == 0),
            "Inconsistent staked amount"
        );

        stakingInfos[stakingInfoID].delegatorAddress = msg.sender;
        stakingInfos[stakingInfoID].nodeAddress = nodeAddress;
        stakingInfos[stakingInfoID].stakeAmount = amount;

        userIndex[msg.sender].add(stakingInfoID);
        nodeIndex[nodeAddress].add(stakingInfoID);

        delegatorStakeAmount[msg.sender] -= oldAmount;
        delegatorStakeAmount[msg.sender] += amount;
        nodeStakeAmount[nodeAddress] -= oldAmount;
        nodeStakeAmount[nodeAddress] += amount;

        delegatorAddresses.add(msg.sender);
        nodeAddresses.add(nodeAddress);

        if (amount < oldAmount) {
            withdrawStaking(msg.sender, oldAmount - amount);
        }
        emit DelegatorStaked(msg.sender, nodeAddress, amount);
    }

    function unstake(address nodeAddress) public {
        bytes32 stakingInfoID = keccak256(
            abi.encodePacked(msg.sender, nodeAddress)
        );

        require(
            stakingInfos[stakingInfoID].stakeAmount > 0,
            "no such staking info"
        );
        require(
            userIndex[msg.sender].contains(stakingInfoID),
            "no such staking info"
        );
        require(
            nodeIndex[nodeAddress].contains(stakingInfoID),
            "no such staking info"
        );

        uint amount = stakingInfos[stakingInfoID].stakeAmount;

        delete stakingInfos[stakingInfoID];
        userIndex[msg.sender].remove(stakingInfoID);
        if (userIndex[msg.sender].length() == 0) {
            delegatorAddresses.remove(msg.sender);
        }
        nodeIndex[nodeAddress].remove(stakingInfoID);
        if (nodeIndex[nodeAddress].length() == 0) {
            nodeAddresses.remove(nodeAddress);
        }

        delegatorStakeAmount[msg.sender] -= amount;
        nodeStakeAmount[nodeAddress] -= amount;

        // withdraw staking tokens
        withdrawStaking(msg.sender, amount);

        emit DelegatorUnstaked(msg.sender, nodeAddress, amount);
    }

    function withdrawStaking(address delegatorAddress, uint amount) private {
        require(amount > 0, "amount is 0");

        (bool success, ) = delegatorAddress.call{value: amount}("");
        require(success, "token transfer failed");
    }

    function slashNodeDelegations(
        address nodeAddress,
        address[] calldata delegators
    ) public {
        require(msg.sender == adminAddress, "Not called by the admin");
        require(delegators.length > 0, "delegators is empty");

        uint totalSlashed = 0;
        for (uint i = 0; i < delegators.length; i++) {
            address delegatorAddress = delegators[i];
            bytes32 stakingInfoID = keccak256(
                abi.encodePacked(delegatorAddress, nodeAddress)
            );
            require(
                stakingInfos[stakingInfoID].stakeAmount > 0,
                "no such staking info"
            );
            require(
                userIndex[delegatorAddress].contains(stakingInfoID),
                "no such staking info"
            );
            require(
                nodeIndex[nodeAddress].contains(stakingInfoID),
                "no such staking info"
            );

            uint amount = stakingInfos[stakingInfoID].stakeAmount;
            userIndex[delegatorAddress].remove(stakingInfoID);
            if (userIndex[delegatorAddress].length() == 0) {
                delegatorAddresses.remove(delegatorAddress);
            }
            nodeIndex[nodeAddress].remove(stakingInfoID);
            if (nodeIndex[nodeAddress].length() == 0) {
                nodeAddresses.remove(nodeAddress);
            }
            delegatorStakeAmount[delegatorAddress] -= amount;
            nodeStakeAmount[nodeAddress] -= amount;
            totalSlashed += amount;

            delete stakingInfos[stakingInfoID];
            emit DelegatorSlashed(delegatorAddress, nodeAddress, amount);
        }
        if (nodeStakeAmount[nodeAddress] == 0) {
            delete nodeStakeAmount[nodeAddress];
        }
        slashStaking(totalSlashed);
    }

    function slashStaking(uint amount) private {
        require(amount > 0, "amount is 0");
        require(slashReceiver != address(0), "slash receiver not set");

        (bool success, ) = slashReceiver.call{value: amount}("");
        require(success, "token transfer failed");
    }

    function getNodeDelegatorShare(
        address nodeAddress
    ) public view returns (uint8) {
        return nodeDelegatorShare[nodeAddress];
    }

    function getDelegatableNodeCount() public view returns (uint) {
        return availableNodes.length();
    }

    function getDelegatableNodes(
        uint256 page,
        uint256 pageSize
    )
        public
        view
        returns (address[] memory, uint8[] memory)
    {
        require(page > 0, "page is 0");
        require(pageSize > 0 && pageSize <= 200, "invalid page size");

        uint256 total = availableNodes.length();
        uint256 start = (page - 1) * pageSize;
        if (start >= total) {
            return (new address[](0), new uint8[](0));
        }

        uint256 end = start + pageSize;
        if (end > total) {
            end = total;
        }

        address[] memory nodes = new address[](end - start);
        uint8[] memory shares = new uint8[](nodes.length);
        for (uint i = 0; i < nodes.length; i++) {
            nodes[i] = availableNodes.at(start + i);
            shares[i] = nodeDelegatorShare[nodes[i]];
        }
        return (nodes, shares);
    }

    function getDelegationStakingAmount(
        address delegatorAddress,
        address nodeAddress
    ) public view returns (uint) {
        bytes32 stakingInfoID = keccak256(
            abi.encodePacked(delegatorAddress, nodeAddress)
        );
        uint amount = stakingInfos[stakingInfoID].stakeAmount;
        return amount;
    }

    function getNodeStakingInfoCount(address nodeAddress) public view returns (uint) {
        return nodeIndex[nodeAddress].length();
    }

    function getNodeStakingInfos(
        address nodeAddress,
        uint256 page,
        uint256 pageSize
    ) public view returns (address[] memory, uint[] memory) {
        require(page > 0, "page is 0");
        require(pageSize > 0 && pageSize <= 200, "invalid page size");

        uint256 total = nodeIndex[nodeAddress].length();
        uint256 start = (page - 1) * pageSize;
        if (start >= total) {
            return (new address[](0), new uint[](0));
        }

        uint256 end = start + pageSize;
        if (end > total) {
            end = total;
        }

        address[] memory addresses = new address[](end - start);
        uint[] memory amounts = new uint[](end - start);

        for (uint i = 0; i < addresses.length; i++) {
            bytes32 stakingInfoID = nodeIndex[nodeAddress].at(start + i);
            addresses[i] = stakingInfos[stakingInfoID].delegatorAddress;
            amounts[i] = stakingInfos[stakingInfoID].stakeAmount;
        }
        return (addresses, amounts);
    }

    function getDelegatorStakingInfos(
        address delegatorAddress
    ) public view returns (address[] memory, uint[] memory) {
        uint length = userIndex[delegatorAddress].length();

        address[] memory addresses = new address[](length);
        uint[] memory amounts = new uint[](length);

        for (uint i = 0; i < length; i++) {
            bytes32 stakingInfoID = userIndex[delegatorAddress].at(i);
            addresses[i] = stakingInfos[stakingInfoID].nodeAddress;
            amounts[i] = stakingInfos[stakingInfoID].stakeAmount;
        }
        return (addresses, amounts);
    }

    function getNodeTotalStakeAmount(
        address nodeAddress
    ) public view returns (uint) {
        return nodeStakeAmount[nodeAddress];
    }

    function getDelegatorTotalStakeAmount(
        address delegatorAddress
    ) public view returns (uint) {
        return delegatorStakeAmount[delegatorAddress];
    }

    function getAllDelegatorAddresses() public view returns (address[] memory) {
        return delegatorAddresses.values();
    }

    function getAllNodeAddresses() public view returns (address[] memory) {
        return nodeAddresses.values();
    }
}
