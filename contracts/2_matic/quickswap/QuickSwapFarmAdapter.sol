// solhint-disable no-unused-vars
// SPDX-License-Identifier: agpl-3.0

pragma solidity =0.8.11;

// helpers
import "../../utils/AdapterModifiersBase.sol";

//  interfaces
import { IERC20 } from "@openzeppelin/contracts-0.8.x/token/ERC20/IERC20.sol";
import { IAdapter } from "@optyfi/defi-legos/interfaces/defiAdapters/contracts/IAdapter.sol";
import { IAdapterHarvestReward } from "@optyfi/defi-legos/interfaces/defiAdapters/contracts/IAdapterHarvestReward.sol";
import { IAdapterInvestLimit, MaxExposure } from "@optyfi/defi-legos/interfaces/defiAdapters/contracts/IAdapterInvestLimit.sol";
import { IUniswapV2Router02 } from "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import { IUniswapV2Pair } from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import { IStakingRewards } from "../../utils/interfaces/IStakingRewards.sol";

/**
 * @title Adapter for Quickswap farm protocol
 * @author Opty.fi
 * @dev Abstraction layer to quickswap farm's pools
 */

contract QuickSwapFarmAdapter is IAdapter, IAdapterHarvestReward, IAdapterInvestLimit, AdapterModifiersBase {
    /**
     * @notice Uniswap V2 router contract address
     */
    address public constant quickswapRouter = address(0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff);
    address public constant quickToken = address(0x831753DD7087CaC61aB5644b308642cc1c33Dc13);
    address public constant wethToken = address(0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619);

    mapping(address => mapping(address => uint256)) public maxDepositAmount;
    mapping(address => uint256) public maxDepositPoolPct;
    uint256 public maxDepositProtocolPct;
    MaxExposure public maxDepositProtocolMode;
    uint256 public constant DENOMINATOR = 10000;

    /* solidity-disable no-empty-blocks*/
    constructor(address _registry) AdapterModifiersBase(_registry) {
        maxDepositProtocolPct = uint256(10000); // 100%
        maxDepositProtocolMode = MaxExposure.Pct;
    }

    /* solidity-enable no-empty-blocks*/

    /**
     * @inheritdoc IAdapter
     */
    function getDepositAllCodes(
        address payable _vault,
        address _underlyingToken,
        address _liquidityPool
    ) public view override returns (bytes[] memory _codes) {
        uint256 _amount = getLiquidityPoolTokenBalance(_vault, _underlyingToken, _liquidityPool);
        return getDepositSomeCodes(_vault, _underlyingToken, _liquidityPool, _amount);
    }

    /**
     * @inheritdoc IAdapter
     */
    function getWithdrawAllCodes(
        address payable _vault,
        address _underlyingToken,
        address _liquidityPool
    ) public view override returns (bytes[] memory _codes) {
        uint256 _redeemAmount = getLiquidityPoolTokenBalanceStake(_vault, _underlyingToken, _liquidityPool);
        return getWithdrawSomeCodes(_vault, _underlyingToken, _liquidityPool, _redeemAmount);
    }

    /**
     * @inheritdoc IAdapter
     */
    function getUnderlyingTokens(address _liquidityPool, address)
        public
        view
        override
        returns (address[] memory _underlyingTokens)
    {
        _underlyingTokens = new address[](2);
        _underlyingTokens[0] = IUniswapV2Pair(_liquidityPool).token0();
        _underlyingTokens[1] = IUniswapV2Pair(_liquidityPool).token1();
    }

    /**
     * @inheritdoc IAdapter
     */
    function calculateAmountInLPToken(
        address,
        address,
        uint256 _depositAmount
    ) public pure override returns (uint256) {
        return _depositAmount;
    }

    /**
     * @inheritdoc IAdapter
     */
    function calculateRedeemableLPTokenAmount(
        address payable _vault,
        address _underlyingToken,
        address _liquidityPool,
        uint256 _redeemAmount
    ) public view override returns (uint256) {
        uint256 _liquidityPoolTokenBalance = IStakingRewards(_liquidityPool).balanceOf(_vault);
        uint256 _balanceInToken = getAllAmountInToken(_vault, _underlyingToken, _liquidityPool);
        return ((_liquidityPoolTokenBalance * _redeemAmount) / _balanceInToken) + 1;
    }

    /**
     * @inheritdoc IAdapter
     */
    function isRedeemableAmountSufficient(
        address payable _vault,
        address _underlyingToken,
        address _liquidityPool,
        uint256 _redeemAmount
    ) public view override returns (bool) {
        uint256 _balanceInToken = getAllAmountInToken(_vault, _underlyingToken, _liquidityPool);
        return _balanceInToken >= _redeemAmount;
    }

    /**
     * @inheritdoc IAdapterHarvestReward
     */
    function getClaimRewardTokenCode(address payable _vault, address _liquidityPool)
        public
        view
        override
        returns (bytes[] memory _codes)
    {
        _codes = new bytes[](2);
        _codes[0] = abi.encode(_liquidityPool, abi.encodeWithSignature("getReward()"));
        address _rewardTokenAddress = getRewardToken(_liquidityPool);
        uint256 _rewardAmount = getUnclaimedRewardTokenAmount(_vault, _liquidityPool, _liquidityPool);
        _codes[1] = abi.encode(_rewardTokenAddress, abi.encodeWithSignature("leave(uint256)", _rewardAmount));
    }

    /**
     * @inheritdoc IAdapterHarvestReward
     */
    function getHarvestAllCodes(
        address payable _vault,
        address _underlyingToken,
        address _liquidityPool
    ) public view override returns (bytes[] memory _codes) {
        uint256 _rewardTokenAmount = IERC20(quickToken).balanceOf(_vault);
        return getHarvestSomeCodes(_vault, _underlyingToken, _liquidityPool, _rewardTokenAmount);
    }

    /**
     * @inheritdoc IAdapter
     */
    function canStake(address) public pure override returns (bool) {
        return true;
    }

    /**
     * @inheritdoc IAdapter
     */
    function getDepositSomeCodes(
        address payable,
        address _underlyingToken,
        address _liquidityPool,
        uint256 _amount
    ) public pure override returns (bytes[] memory _codes) {
        if (_amount > 0) {
            _codes = new bytes[](3);
            _codes[0] = abi.encode(
                _underlyingToken,
                abi.encodeWithSignature("approve(address,uint256)", _liquidityPool, uint256(0))
            );
            _codes[1] = abi.encode(
                _underlyingToken,
                abi.encodeWithSignature("approve(address,uint256)", _liquidityPool, _amount)
            );
            _codes[2] = abi.encode(_liquidityPool, abi.encodeWithSignature("stake(uint256)", _amount));
        }
    }

    /**
     * @inheritdoc IAdapter
     */
    function getWithdrawSomeCodes(
        address payable,
        address,
        address _liquidityPool,
        uint256 _shares
    ) public pure override returns (bytes[] memory _codes) {
        if (_shares > 0) {
            _codes = new bytes[](1);
            _codes[0] = abi.encode(_liquidityPool, abi.encodeWithSignature("withdraw(uint256)", _shares));
        }
    }

    /**
     * @inheritdoc IAdapter
     */
    function getPoolValue(address _liquidityPool, address) public view override returns (uint256) {
        return IStakingRewards(_liquidityPool).totalSupply();
    }

    /**
     * @inheritdoc IAdapter
     */
    function getLiquidityPoolToken(address, address _liquidityPool) public pure override returns (address) {
        return _liquidityPool;
    }

    /**
     * @inheritdoc IAdapter
     */
    function getAllAmountInToken(
        address payable _vault,
        address _underlyingToken,
        address _liquidityPool
    ) public view override returns (uint256) {
        uint256 _liquidityPoolTokenAmount = getLiquidityPoolTokenBalance(_vault, _underlyingToken, _liquidityPool);
        uint256 _unclaimedRewardQuickAmount = IERC20(quickToken).balanceOf(_vault);

        if (_unclaimedRewardQuickAmount > 0) {
            _liquidityPoolTokenAmount =
                _liquidityPoolTokenAmount +
                getSomeAmountInToken(_underlyingToken, _liquidityPool, _unclaimedRewardQuickAmount);
        }
        return _liquidityPoolTokenAmount;
    }

    /**
     * @inheritdoc IAdapter
     */
    function getLiquidityPoolTokenBalance(
        address payable _vault,
        address _underlyingToken,
        address
    ) public view override returns (uint256) {
        return IERC20(_underlyingToken).balanceOf(_vault);
    }

    /**
     * @inheritdoc IAdapter
     */
    function getSomeAmountInToken(
        address _underlyingToken,
        address,
        uint256 _liquidityPoolTokenAmount
    ) public view override returns (uint256) {
        return _getRewardBalanceInUnderlyingTokens(quickToken, _underlyingToken, _liquidityPoolTokenAmount);
    }

    /**
     * @inheritdoc IAdapter
     */
    function getRewardToken(address _liquidityPool) public view override returns (address) {
        return IStakingRewards(_liquidityPool).rewardsToken();
    }

    /**
     * @inheritdoc IAdapterHarvestReward
     */
    function getUnclaimedRewardTokenAmount(
        address payable _vault,
        address _liquidityPool,
        address
    ) public view override returns (uint256) {
        return IStakingRewards(_liquidityPool).earned(_vault);
    }

    /**
     * @inheritdoc IAdapterHarvestReward
     */
    function getHarvestSomeCodes(
        address payable _vault,
        address _underlyingToken,
        address,
        uint256 _rewardTokenAmount
    ) public view override returns (bytes[] memory _codes) {
        return _getHarvestCodes(_vault, quickToken, _underlyingToken, _rewardTokenAmount);
    }

    /* solhint-disable no-empty-blocks */
    /**
     * @inheritdoc IAdapterHarvestReward
     */
    function getAddLiquidityCodes(address payable, address) public view override returns (bytes[] memory) {}

    /**
     * @inheritdoc IAdapterInvestLimit
     */
    function setMaxDepositAmount(
        address _liquidityPool,
        address _underlyingToken,
        uint256 _maxDepositAmount
    ) external override onlyRiskOperator {
        maxDepositAmount[_liquidityPool][_underlyingToken] = _maxDepositAmount;
        emit LogMaxDepositAmount(_maxDepositAmount, msg.sender);
    }

    /**
     * @inheritdoc IAdapterInvestLimit
     */
    function setMaxDepositPoolPct(address _liquidityPool, uint256 _maxDepositPoolPct)
        external
        override
        onlyRiskOperator
    {
        maxDepositPoolPct[_liquidityPool] = _maxDepositPoolPct;
        emit LogMaxDepositPoolPct(_maxDepositPoolPct, msg.sender);
    }

    /**
     * @inheritdoc IAdapterInvestLimit
     */
    function setMaxDepositProtocolPct(uint256 _maxDepositProtocolPct) external override onlyRiskOperator {
        maxDepositProtocolPct = _maxDepositProtocolPct;
        emit LogMaxDepositProtocolPct(_maxDepositProtocolPct, msg.sender);
    }

    /**
     * @inheritdoc IAdapterInvestLimit
     */
    function setMaxDepositProtocolMode(MaxExposure _mode) external override onlyRiskOperator {
        maxDepositProtocolMode = _mode;
        emit LogMaxDepositProtocolMode(_mode, msg.sender);
    }

    /* solhint-enable no-empty-blocks */
    /**
     * @notice Returns amount of lpTokens staked by the vault
     * @param _vault Vault contract address
     * @param _liquidityPool Vault address
     * @return Returns the lpToken balance that is staked by the vault
     */
    function getLiquidityPoolTokenBalanceStake(
        address payable _vault,
        address,
        address _liquidityPool
    ) public view returns (uint256) {
        return IStakingRewards(_liquidityPool).balanceOf(_vault);
    }

    /**
     * @dev Get the codes for harvesting the tokens using uniswap router
     * @param _vault Vault contract address
     * @param _rewardToken Reward token address
     * @param _underlyingToken Token address acting as underlying Asset for the vault contract
     * @param _rewardTokenAmount reward token amount to harvest
     * @return _codes List of harvest codes for harvesting reward tokens
     */
    function _getHarvestCodes(
        address payable _vault,
        address _rewardToken,
        address _underlyingToken,
        uint256 _rewardTokenAmount
    ) internal view returns (bytes[] memory _codes) {
        if (_rewardTokenAmount > 0) {
            uint256[] memory _amounts = IUniswapV2Router02(quickswapRouter).getAmountsOut(
                _rewardTokenAmount,
                _getPath(_rewardToken, _underlyingToken)
            );
            if (_amounts[_amounts.length - 1] > 0) {
                _codes = new bytes[](3);
                _codes[0] = abi.encode(
                    _rewardToken,
                    abi.encodeWithSignature("approve(address,uint256)", quickswapRouter, uint256(0))
                );
                _codes[1] = abi.encode(
                    _rewardToken,
                    abi.encodeWithSignature("approve(address,uint256)", quickswapRouter, _rewardTokenAmount)
                );
                _codes[2] = abi.encode(
                    quickswapRouter,
                    abi.encodeWithSignature(
                        "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
                        _rewardTokenAmount,
                        uint256(0),
                        _getPath(_rewardToken, _underlyingToken),
                        _vault,
                        type(uint256).max
                    )
                );
            }
        }
    }

    /**
     * @dev Constructs the path for token swap on Uniswap
     * @param _initialToken The token to be swapped with
     * @param _finalToken The token to be swapped for
     * @return _path The array of tokens in the sequence to be swapped for
     */
    function _getPath(address _initialToken, address _finalToken) internal pure returns (address[] memory _path) {
        if (_finalToken == wethToken) {
            _path = new address[](2);
            _path[0] = _initialToken;
            _path[1] = wethToken;
        } else if (_initialToken == wethToken) {
            _path = new address[](2);
            _path[0] = wethToken;
            _path[1] = _finalToken;
        } else {
            _path = new address[](3);
            _path[0] = _initialToken;
            _path[1] = wethToken;
            _path[2] = _finalToken;
        }
    }

    /**
     * @dev Get the underlying token amount equivalent to reward token amount
     * @param _rewardToken Reward token address
     * @param _underlyingToken Token address acting as underlying Asset for the vault contract
     * @param _amount reward token balance amount
     * @return equivalent reward token balance in Underlying token value
     */
    function _getRewardBalanceInUnderlyingTokens(
        address _rewardToken,
        address _underlyingToken,
        uint256 _amount
    ) internal view returns (uint256) {
        uint256[] memory _amountsA = IUniswapV2Router02(quickswapRouter).getAmountsOut(
            _amount,
            _getPath(_rewardToken, _underlyingToken)
        );
        return _amountsA[_amountsA.length - 1];
    }
}
