// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./ParameterControlled.sol";

contract Credits is ParameterControlled {
    using EnumerableSet for EnumerableSet.AddressSet;

    // store all nodes with credits
    EnumerableSet.AddressSet private allCreditAddresses;
    mapping(address => uint) private credits;

    event CreditsBought(address indexed fromAddr, address indexed toAddr, uint amount);
    event CreditsStaked(address indexed addr, uint amount);
    event CreditsUnstaked(address indexed addr, uint amount);

    address private stakingAddress;
    address private adminAddress;

    constructor(
    ) {}

    function setStakingAddress(address addr) external onlyOwner {
        require(stakingAddress == address(0), "Staking address already set");
        require(addr != address(0), "Staking address cannot be zero");
        stakingAddress = addr;
    }

    function setAdminAddress(address addr) external onlyParameterController {
        adminAddress = addr;
    }

    function getCredits(address addr) public view returns (uint) {
        return credits[addr];
    }

    function getAllCreditAddresses() public view returns (address[] memory) {
        return allCreditAddresses.values();
    }

    function getAllCredits() public view returns (address[] memory, uint[] memory) {
        address[] memory addresses = allCreditAddresses.values();
        uint[] memory amounts = new uint[](addresses.length);
        for (uint i = 0; i < addresses.length; i++) {
            amounts[i] = credits[addresses[i]];
        }
        return (addresses, amounts);
    }

    function createCredits(address addr, uint amount) public {
        require(msg.sender == adminAddress, "Not called by the admin");
        credits[addr] += amount;
        allCreditAddresses.add(addr);
        emit CreditsBought(msg.sender, addr, amount);
    }

    function stakeCredits(address addr, uint amount) public {
        require(msg.sender == stakingAddress, "Not called by the staking contract");
        require(credits[addr] >= amount, "Insufficient credits");
        credits[addr] -= amount;
        credits[stakingAddress] += amount;
        emit CreditsStaked(addr, amount);
    }

    function unstakeCredits(address addr, uint amount) public {
        require(msg.sender == stakingAddress, "Not called by the staking contract");
        require(credits[stakingAddress] >= amount, "Staked credits is not enough");
        credits[stakingAddress] -= amount;
        credits[addr] += amount;
        emit CreditsUnstaked(addr, amount);
    }
}