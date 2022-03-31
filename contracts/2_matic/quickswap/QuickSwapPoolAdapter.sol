// solhint-disable no-unused-vars
// SPDX-License-Identifier: agpl-3.0

pragma solidity =0.8.11;

// interfaces
import { IERC20 } from "@openzeppelin/contracts-0.8.x/token/ERC20/IERC20.sol";
import { IAdapter } from "@optyfi/defi-legos/interfaces/defiAdapters/contracts/IAdapter.sol";
import { IAdapterInvestLimit, MaxExposure } from "@optyfi/defi-legos/interfaces/defiAdapters/contracts/IAdapterInvestLimit.sol";
import { IUniswapV2Router02 } from "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import { IUniswapV2Pair } from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import { IUniswapV2Factory } from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import { Babylonian } from "@uniswap/lib/contracts/libraries/Babylonian.sol";
import { UniswapV2Library } from "../../libraries/UniswapV2Library.sol";

/**
 * @title Adapter for QuickSwap.finance protocol
 * @author Opty.fi
 * @dev Abstraction layer to QuickSwap finance's pools
 */

contract QuickSwapPoolAdapter is IAdapter, IAdapterInvestLimit {
    /**
     * @notice Uniswap V2 router contract address
     */
    IUniswapV2Router02 public constant quickswapRouter = IUniswapV2Router02(0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff);
    IUniswapV2Factory public constant factoryRouter = IUniswapV2Factory(0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32);
    mapping(address => mapping(address => uint256)) public maxDepositAmount;
    mapping(address => uint256) public maxDepositPoolPct;
    uint256 public maxDepositProtocolPct;
    MaxExposure public maxDepositProtocolMode;
    address public adjuster;
    uint256 public constant DENOMINATOR = 10000;

    constructor() {
        adjuster = msg.sender;
    }

    /**
     * @inheritdoc IAdapter
     */
    function getDepositAllCodes(
        address payable _vault,
        address _underlyingToken,
        address _liquidityPool
    ) public view override returns (bytes[] memory _codes) {
        uint256 _amount = IERC20(_underlyingToken).balanceOf(_vault);
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
        uint256 _redeemAmount = getLiquidityPoolTokenBalance(_vault, _underlyingToken, _liquidityPool);
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
        address _underlyingToken,
        address _liquidityPool,
        uint256 _depositAmount
    ) public view override returns (uint256) {
        (uint256 reserve0, uint256 reserve1, ) = IUniswapV2Pair(_liquidityPool).getReserves();
        if (IUniswapV2Pair(_liquidityPool).token0() != _underlyingToken) {
            (reserve0, reserve1) = (reserve1, reserve0);
        }
        uint256 swapInAmount = _calculateSwapInAmount(reserve0, _depositAmount);
        uint256 swapOutAmount = UniswapV2Library.getAmountOut(swapInAmount, reserve0, reserve1);
        reserve0 = reserve0 + swapInAmount;
        reserve1 = reserve1 - swapOutAmount;
        uint256 _totalSupply = _getPoolTotalSupply(_liquidityPool, reserve0, reserve1);
        uint256 amount0Optimal = _depositAmount - swapInAmount;
        uint256 amount1Optimal = UniswapV2Library.quote(amount0Optimal, reserve0, reserve1);
        if (amount1Optimal > swapOutAmount) {
            amount1Optimal = swapOutAmount;
            amount0Optimal = UniswapV2Library.quote(amount1Optimal, reserve1, reserve0);
        }
        uint256 liquidity = (amount0Optimal * _totalSupply) / reserve0;
        if (liquidity > (amount1Optimal * _totalSupply) / reserve1) {
            liquidity = (amount1Optimal * _totalSupply) / reserve1;
        }
        return liquidity;
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
        uint256 _liquidityPoolTokenBalance = getLiquidityPoolTokenBalance(_vault, _underlyingToken, _liquidityPool);
        uint256 _balanceInToken = getAllAmountInToken(_vault, _underlyingToken, _liquidityPool);
        return (_liquidityPoolTokenBalance * _redeemAmount) / _balanceInToken + 1;
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
     * @inheritdoc IAdapter
     */
    function canStake(address) public pure override returns (bool) {
        return false;
    }

    /**
     * @inheritdoc IAdapter
     */
    function getDepositSomeCodes(
        address payable _vault,
        address _underlyingToken,
        address _liquidityPool,
        uint256 _amount
    ) public view override returns (bytes[] memory _codes) {
        _amount = _getLimitedAmount(_underlyingToken, _liquidityPool, _amount);
        if (_amount > 0) {
            _codes = new bytes[](6);
            _codes[0] = abi.encode(
                _underlyingToken,
                abi.encodeWithSignature("approve(address,uint256)", quickswapRouter, uint256(0))
            );
            address toToken;
            uint256 swapInAmount;
            uint256 swapOutAmount;
            // avoid stack too deep
            {
                (uint256 reserve0, uint256 reserve1, ) = IUniswapV2Pair(_liquidityPool).getReserves();
                toToken = IUniswapV2Pair(_liquidityPool).token1();
                if (toToken == _underlyingToken) {
                    (reserve0, reserve1) = (reserve1, reserve0);
                    toToken = IUniswapV2Pair(_liquidityPool).token0();
                }
                swapInAmount = _calculateSwapInAmount(reserve0, _amount);
                swapOutAmount = UniswapV2Library.getAmountOut(swapInAmount, reserve0, reserve1);
            }
            _codes[1] = abi.encode(
                _underlyingToken,
                abi.encodeWithSignature("approve(address,uint256)", quickswapRouter, _amount)
            );
            address[] memory path = new address[](2);
            path[0] = _underlyingToken;
            path[1] = toToken;
            _codes[2] = abi.encode(
                quickswapRouter,
                abi.encodeWithSignature(
                    "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
                    swapInAmount,
                    0,
                    path,
                    _vault,
                    type(uint256).max
                )
            );
            _codes[3] = abi.encode(
                toToken,
                abi.encodeWithSignature("approve(address,uint256)", quickswapRouter, uint256(0))
            );
            _codes[4] = abi.encode(
                toToken,
                abi.encodeWithSignature("approve(address,uint256)", quickswapRouter, swapOutAmount)
            );
            _codes[5] = abi.encode(
                quickswapRouter,
                abi.encodeWithSignature(
                    "addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256)",
                    _underlyingToken,
                    toToken,
                    _amount - swapInAmount,
                    swapOutAmount,
                    0,
                    0,
                    _vault,
                    type(uint256).max
                )
            );
        }
    }

    /**
     * @inheritdoc IAdapter
     */
    function getWithdrawSomeCodes(
        address payable _vault,
        address _underlyingToken,
        address _liquidityPool,
        uint256 _shares
    ) public view override returns (bytes[] memory _codes) {
        if (_shares > 0) {
            _codes = new bytes[](6);
            _codes[0] = abi.encode(
                _liquidityPool,
                abi.encodeWithSignature("approve(address,uint256)", quickswapRouter, 0)
            );
            _codes[1] = abi.encode(
                _liquidityPool,
                abi.encodeWithSignature("approve(address,uint256)", quickswapRouter, _shares)
            );
            address toToken = IUniswapV2Pair(_liquidityPool).token1();
            (uint256 outAmountA, uint256 outAmountB, ) = IUniswapV2Pair(_liquidityPool).getReserves();
            uint256 _totalSupply = _getPoolTotalSupply(_liquidityPool, outAmountA, outAmountB);
            outAmountA = (outAmountA * _shares) / _totalSupply;
            outAmountB = (outAmountB * _shares) / _totalSupply;
            if (toToken == _underlyingToken) {
                toToken = IUniswapV2Pair(_liquidityPool).token0();
                (outAmountA, outAmountB) = (outAmountB, outAmountA);
            }
            _codes[2] = abi.encode(
                quickswapRouter,
                abi.encodeWithSignature(
                    "removeLiquidity(address,address,uint256,uint256,uint256,address,uint256)",
                    _underlyingToken,
                    toToken,
                    _shares,
                    0,
                    0,
                    _vault,
                    type(uint256).max
                )
            );
            _codes[3] = abi.encode(toToken, abi.encodeWithSignature("approve(address,uint256)", _liquidityPool, 0));
            _codes[4] = abi.encode(
                toToken,
                abi.encodeWithSignature("approve(address,uint256)", quickswapRouter, outAmountB)
            );
            address[] memory path = new address[](2);
            path[0] = toToken;
            path[1] = _underlyingToken;
            _codes[5] = abi.encode(
                quickswapRouter,
                abi.encodeWithSignature(
                    "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
                    outAmountB,
                    0,
                    path,
                    _vault,
                    type(uint256).max
                )
            );
        }
    }

    /**
     * @inheritdoc IAdapter
     */
    function getPoolValue(address _liquidityPool, address _underlyingToken) public view override returns (uint256) {
        return IERC20(_underlyingToken).balanceOf(_liquidityPool) * 2;
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
        return
            getSomeAmountInToken(
                _underlyingToken,
                _liquidityPool,
                getLiquidityPoolTokenBalance(_vault, _underlyingToken, _liquidityPool)
            );
    }

    /**
     * @inheritdoc IAdapter
     */
    function getLiquidityPoolTokenBalance(
        address payable _vault,
        address,
        address _liquidityPool
    ) public view override returns (uint256) {
        return IERC20(_liquidityPool).balanceOf(_vault);
    }

    /**
     * @inheritdoc IAdapter
     */
    function getSomeAmountInToken(
        address _underlyingToken,
        address _liquidityPool,
        uint256 _liquidityPoolTokenAmount
    ) public view override returns (uint256) {
        (uint256 reserve0, uint256 reserve1, ) = IUniswapV2Pair(_liquidityPool).getReserves();
        uint256 _totalSupply = _getPoolTotalSupply(_liquidityPool, reserve0, reserve1);
        if (IUniswapV2Pair(_liquidityPool).token0() != _underlyingToken) {
            (reserve0, reserve1) = (reserve1, reserve0);
        }
        uint256 underlyingTokenAmount = (reserve0 * _liquidityPoolTokenAmount) / _totalSupply;
        uint256 swapTokenAmount = (reserve1 * _liquidityPoolTokenAmount) / _totalSupply;
        uint256 swapOutAmount = UniswapV2Library.getAmountOut(
            swapTokenAmount,
            reserve1 - swapTokenAmount,
            reserve0 - underlyingTokenAmount
        );
        return underlyingTokenAmount + swapOutAmount;
    }

    /**
     * @inheritdoc IAdapter
     */
    function getRewardToken(address) public pure override returns (address) {
        return address(0);
    }

    /**
     * @inheritdoc IAdapterInvestLimit
     */
    function setMaxDepositAmount(
        address _liquidityPool,
        address _underlyingToken,
        uint256 _maxDepositAmount
    ) external override {
        require(adjuster == msg.sender, "Not adjuster");
        maxDepositAmount[_liquidityPool][_underlyingToken] = _maxDepositAmount;
        emit LogMaxDepositAmount(_maxDepositAmount, msg.sender);
    }

    /**
     * @inheritdoc IAdapterInvestLimit
     */
    function setMaxDepositPoolPct(address _liquidityPool, uint256 _maxDepositPoolPct) external override {
        require(adjuster == msg.sender, "Not adjuster");
        maxDepositPoolPct[_liquidityPool] = _maxDepositPoolPct;
        emit LogMaxDepositPoolPct(_maxDepositPoolPct, msg.sender);
    }

    /**
     * @inheritdoc IAdapterInvestLimit
     */
    function setMaxDepositProtocolPct(uint256 _maxDepositProtocolPct) external override {
        require(adjuster == msg.sender, "Not adjuster");
        maxDepositProtocolPct = _maxDepositProtocolPct;
        emit LogMaxDepositProtocolPct(_maxDepositProtocolPct, msg.sender);
    }

    /**
     * @inheritdoc IAdapterInvestLimit
     */
    function setMaxDepositProtocolMode(MaxExposure _mode) external override {
        require(adjuster == msg.sender, "Not adjuster");
        maxDepositProtocolMode = _mode;
        emit LogMaxDepositProtocolMode(_mode, msg.sender);
    }

    /**
     * @dev Get the swap amount to deposit either token in QuickSwap liquidity pool
     * @param reserveIn Reserve amount of the deposit token
     * @param userIn Input amount of the deposit token
     * @return Amount to swap of the deposit token
     */
    function _calculateSwapInAmount(uint256 reserveIn, uint256 userIn) internal pure returns (uint256) {
        return (Babylonian.sqrt(reserveIn * (userIn * 3988000 + reserveIn * 3988009)) - (reserveIn * 1997)) / 1994;
    }

    /**
     * @dev Get the limited amount to deposit
     * @param _underlyingToken Contract address of the liquidity pool's underlying token
     * @param _liquidityPool Liquidity pool's contract address
     * @param _amount Deposit amount
     * @return _limitedAmount calculated limited amount
     */
    function _getLimitedAmount(
        address _underlyingToken,
        address _liquidityPool,
        uint256 _amount
    ) internal view returns (uint256 _limitedAmount) {
        if (maxDepositProtocolMode == MaxExposure.Number) {
            if (_amount > maxDepositAmount[_liquidityPool][_underlyingToken]) {
                _limitedAmount = maxDepositAmount[_liquidityPool][_underlyingToken];
            } else {
                _limitedAmount = _amount;
            }
        } else {
            uint256 totalAmount = getPoolValue(_liquidityPool, _underlyingToken);
            if (maxDepositPoolPct[_liquidityPool] > 0) {
                if (_amount > (totalAmount * maxDepositPoolPct[_liquidityPool]) / DENOMINATOR) {
                    _limitedAmount = (totalAmount * maxDepositPoolPct[_liquidityPool]) / DENOMINATOR;
                } else {
                    _limitedAmount = _amount;
                }
            } else if (maxDepositProtocolPct > 0) {
                if (_amount > (totalAmount * maxDepositProtocolPct) / DENOMINATOR) {
                    _limitedAmount = (totalAmount * maxDepositProtocolPct) / DENOMINATOR;
                } else {
                    _limitedAmount = _amount;
                }
            }
        }
    }

    /**
     * @dev Get the totalSupply of liquidty Pool
     * @param _liquidityPool Liquidity pool's contract address
     * @param _reserve0 reserve value of token0
     * @param _reserve1 reserve value of token1
     * @return _totalSupply calculated totalSupply amount
     */
    function _getPoolTotalSupply(
        address _liquidityPool,
        uint256 _reserve0,
        uint256 _reserve1
    ) internal view returns (uint256 _totalSupply) {
        _totalSupply = IUniswapV2Pair(_liquidityPool).totalSupply();
        if (factoryRouter.feeTo() != address(0)) {
            uint256 _kLast = IUniswapV2Pair(_liquidityPool).kLast();
            if (_kLast != 0) {
                uint256 rootK = Babylonian.sqrt(_reserve0 * _reserve1);
                uint256 rootKLast = Babylonian.sqrt(_kLast);
                if (rootK > rootKLast) {
                    uint256 numerator = _totalSupply * (rootK - rootKLast);
                    uint256 denominator = rootK * 5 + rootKLast;
                    uint256 liquidity = numerator / denominator;
                    if (liquidity > 0) _totalSupply += liquidity;
                }
            }
        }
    }
}
