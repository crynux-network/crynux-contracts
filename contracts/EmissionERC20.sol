// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract EmissionERC20 {
    using SafeERC20 for IERC20Metadata;

    enum Mode {
        Primary,
        Mirror
    }

    uint256 public constant WEEKS_PER_YEAR = 52;
    uint256 public constant TOTAL_YEARS = 21;
    uint256 public constant TOTAL_PERIODS = 1 + ((TOTAL_YEARS - 1) * WEEKS_PER_YEAR);
    uint256 public constant YEAR0_EMISSION = 1_723_466_646;

    IERC20Metadata public immutable token;
    Mode public immutable mode;
    address public immutable daoTreasuryAddress;
    address public immutable relayWalletColdAddress;
    uint256 public immutable startTimestamp;
    uint256 public immutable initCost;
    uint256 public immutable tokenUnit;

    uint256 public nextEmissionIndex;

    event EmissionExecuted(
        uint256 indexed periodIndex,
        uint8 indexed yearIndex,
        uint256 totalAmount,
        uint256 relayAmount,
        uint256 daoAmount
    );

    constructor(
        address tokenAddress,
        Mode modeValue,
        address daoTreasury,
        address relayWalletCold,
        uint256 startTs,
        uint256 initialEmissionIndex,
        uint256 initCostValue
    ) {
        require(tokenAddress != address(0), "token is zero");
        require(daoTreasury != address(0), "dao treasury is zero");
        require(relayWalletCold != address(0), "relay cold wallet is zero");
        require(initialEmissionIndex <= TOTAL_PERIODS, "initial index exceeds max");
        if (modeValue == Mode.Mirror) {
            require(initCostValue == 0, "mirror init cost must be zero");
        }

        token = IERC20Metadata(tokenAddress);
        mode = modeValue;
        daoTreasuryAddress = daoTreasury;
        relayWalletColdAddress = relayWalletCold;
        startTimestamp = startTs;
        nextEmissionIndex = initialEmissionIndex;
        initCost = initCostValue;
        tokenUnit = 10 ** token.decimals();
    }

    function emission() external {
        uint256 periodIndex = nextEmissionIndex;
        require(periodIndex < TOTAL_PERIODS, "all emissions completed");
        require(block.timestamp >= getDueTimestamp(periodIndex), "emission is not due");

        nextEmissionIndex = periodIndex + 1;
        _releasePeriod(periodIndex);
    }

    function getDueTimestamp(uint256 periodIndex) public view returns (uint256) {
        require(periodIndex < TOTAL_PERIODS, "period index exceeds max");
        if (periodIndex == 0) {
            return startTimestamp;
        }
        return startTimestamp + (periodIndex * 1 weeks);
    }

    function getYearIndex(uint256 periodIndex) public pure returns (uint8) {
        require(periodIndex < TOTAL_PERIODS, "period index exceeds max");
        if (periodIndex == 0) {
            return 0;
        }
        return uint8(((periodIndex - 1) / WEEKS_PER_YEAR) + 1);
    }

    function getNominalEmissionAmount(uint256 periodIndex) public pure returns (uint256) {
        uint8 yearIndex = getYearIndex(periodIndex);
        if (yearIndex == 0) {
            return YEAR0_EMISSION;
        }
        return _weeklyEmissionByYear(yearIndex);
    }

    function _releasePeriod(uint256 periodIndex) private {
        uint8 yearIndex = getYearIndex(periodIndex);
        uint256 nominalAmount = getNominalEmissionAmount(periodIndex);
        uint256 totalAmount = nominalAmount * tokenUnit;

        uint256 relayAmount = totalAmount;
        uint256 daoAmount = 0;

        if (mode == Mode.Primary) {
            uint256 daoPercent = yearIndex <= 1 ? 30 : 20;
            daoAmount = (totalAmount * daoPercent) / 100;

            if (periodIndex == 0 && initCost > 0) {
                uint256 initCostAmount = initCost * tokenUnit;
                require(daoAmount >= initCostAmount, "init cost exceeds dao share");
                daoAmount -= initCostAmount;
            }

            relayAmount = totalAmount - ((totalAmount * daoPercent) / 100);
        }

        if (relayAmount > 0) {
            token.safeTransfer(relayWalletColdAddress, relayAmount);
        }
        if (daoAmount > 0) {
            token.safeTransfer(daoTreasuryAddress, daoAmount);
        }

        emit EmissionExecuted(periodIndex, yearIndex, totalAmount, relayAmount, daoAmount);
    }

    function _weeklyEmissionByYear(uint8 yearIndex) private pure returns (uint256) {
        if (yearIndex == 1) return 13_257_447;
        if (yearIndex == 2) return 12_171_771;
        if (yearIndex == 3) return 11_175_003;
        if (yearIndex == 4) return 10_259_862;
        if (yearIndex == 5) return 9_419_664;
        if (yearIndex == 6) return 8_648_271;
        if (yearIndex == 7) return 7_940_049;
        if (yearIndex == 8) return 7_289_824;
        if (yearIndex == 9) return 6_692_848;
        if (yearIndex == 10) return 6_144_758;
        if (yearIndex == 11) return 5_641_553;
        if (yearIndex == 12) return 5_179_556;
        if (yearIndex == 13) return 4_755_393;
        if (yearIndex == 14) return 4_365_966;
        if (yearIndex == 15) return 4_008_429;
        if (yearIndex == 16) return 3_680_172;
        if (yearIndex == 17) return 3_378_796;
        if (yearIndex == 18) return 3_102_100;
        if (yearIndex == 19) return 2_848_064;
        if (yearIndex == 20) return 2_614_832;
        revert("invalid year index");
    }
}
