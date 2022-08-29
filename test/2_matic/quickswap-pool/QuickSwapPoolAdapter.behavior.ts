import hre from "hardhat";
import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { BigNumber } from "ethers";
import { PoolItem } from "../types";
import { getOverrideOptions, setTokenBalanceInStorage } from "../../utils";
import { ERC20 } from "../../../typechain";
import { default as QuickswapPools } from "../../../helpers/quickswap_pools_small_test_list.json";
import tokens from "../../../helpers/tokens.json";

chai.use(solidity);

export function shouldBehaveLikeQuickSwapPoolAdapter(
  underlyingTokenName: string,
  poolName: string,
  pool: PoolItem,
): void {
  it(`should deposit ${underlyingTokenName} and withdraw ${underlyingTokenName} in ${poolName} pool of Sushiswap`, async function () {
    if (pool.deprecated == true) {
      this.skip();
    }
    // quickswap's deposit pool instance
    const quickswapDepositInstance = await hre.ethers.getContractAt(
      "@optyfi/defi-legos/ethereum/uniswapV2/contracts/IUniswapV2Pair.sol:IUniswapV2Pair",
      pool.pool,
    );

    // token0 instance
    const token0Instance = <ERC20>(
      await hre.ethers.getContractAt("@openzeppelin/contracts-0.8.x/token/ERC20/ERC20.sol:ERC20", pool.token0)
    );

    // token1 instance
    const token1Instance = <ERC20>(
      await hre.ethers.getContractAt("@openzeppelin/contracts-0.8.x/token/ERC20/ERC20.sol:ERC20", pool.token1)
    );

    let underlyingTokenInstance: ERC20;
    let toTokenInstance: ERC20;
    let reserve0: BigNumber;
    let reserve1: BigNumber;

    if (tokens[underlyingTokenName as keyof typeof tokens] == pool.token0) {
      underlyingTokenInstance = token0Instance;
      toTokenInstance = token1Instance;
      reserve0 = (await quickswapDepositInstance.getReserves())[0];
      reserve1 = (await quickswapDepositInstance.getReserves())[1];
    } else {
      underlyingTokenInstance = token1Instance;
      toTokenInstance = token0Instance;
      reserve0 = (await quickswapDepositInstance.getReserves())[1];
      reserve1 = (await quickswapDepositInstance.getReserves())[0];
    }

    await setTokenBalanceInStorage(underlyingTokenInstance, this.testDeFiAdapter.address, "20");

    // 1. deposit all underlying tokens
    await this.testDeFiAdapter.testGetDepositAllCodes(
      underlyingTokenInstance.address,
      pool.pool,
      this.quickSwapPoolAdapter.address,
      getOverrideOptions(),
    );
    // 2. assert whether lptoken balance is as expected or not after deposit
    const actualLPTokenBalanceAfterDeposit = await this.quickSwapPoolAdapter.getLiquidityPoolTokenBalance(
      this.testDeFiAdapter.address,
      this.testDeFiAdapter.address, // placeholder of type address
      pool.pool,
    );

    const expectedLPTokenBalanceAfterDeposit = await quickswapDepositInstance.balanceOf(this.testDeFiAdapter.address);
    expect(actualLPTokenBalanceAfterDeposit).to.be.eq(expectedLPTokenBalanceAfterDeposit);
    // 3. assert whether underlying token balance is as expected or not after deposit
    const actualUnderlyingTokenBalanceAfterDeposit = await this.testDeFiAdapter.getERC20TokenBalance(
      underlyingTokenInstance.address,
      this.testDeFiAdapter.address,
    );
    const expectedUnderlyingTokenBalanceAfterDeposit = await underlyingTokenInstance.balanceOf(
      this.testDeFiAdapter.address,
    );
    expect(actualUnderlyingTokenBalanceAfterDeposit).to.be.eq(expectedUnderlyingTokenBalanceAfterDeposit);

    // 4. assert whether the amount in token is as expected or not after depositing
    const _underlyingTokenBalanceInVaultAfterDeposit = await underlyingTokenInstance.balanceOf(
      this.testDeFiAdapter.address,
    );
    const vaultToTokenBalance = await this.testDeFiAdapter.getERC20TokenBalance(
      toTokenInstance.address,
      this.testDeFiAdapter.address,
    );

    // 5. Withdraw all lpToken balance
    await this.testDeFiAdapter.testGetWithdrawAllCodes(
      underlyingTokenInstance.address,
      pool.pool,
      this.quickSwapPoolAdapter.address,
      getOverrideOptions(),
    );

    // 6. assert whether lpToken balance is as expected or not
    const actualLPTokenBalanceAfterWithdraw = await this.quickSwapPoolAdapter.getLiquidityPoolTokenBalance(
      this.testDeFiAdapter.address,
      this.testDeFiAdapter.address, // placeholder of type address
      pool.pool,
    );
    const expectedLPTokenBalanceAfterWithdraw = await quickswapDepositInstance.balanceOf(this.testDeFiAdapter.address);
    expect(actualLPTokenBalanceAfterWithdraw).to.be.eq(expectedLPTokenBalanceAfterWithdraw);

    // 7. assert whether underlying token balance is as expected or not after withdraw
    const actualUnderlyingTokenBalanceAfterWithdraw = await this.testDeFiAdapter.getERC20TokenBalance(
      underlyingTokenInstance.address,
      this.testDeFiAdapter.address,
    );

    const slippage = await this.quickSwapPoolAdapter.liquidityPoolToWantTokenToSlippage(
      pool.pool,
      underlyingTokenInstance.address,
    );
    const amountOutUT = await this.quickSwapPoolAdapter.getSomeAmountInToken(
      underlyingTokenInstance.address,
      pool.pool,
      actualLPTokenBalanceAfterDeposit,
    );
    let vaultToTokenBalanceInUT = BigNumber.from("0");
    if (vaultToTokenBalance.gt(BigNumber.from("0"))) {
      vaultToTokenBalanceInUT = await this.quickswapRouter.getAmountOut(vaultToTokenBalance, reserve1, reserve0);
    }
    expect(actualUnderlyingTokenBalanceAfterWithdraw).to.be.gte(
      amountOutUT
        .div(BigNumber.from("2"))
        .add(
          amountOutUT
            .div(BigNumber.from("2"))
            .add(vaultToTokenBalanceInUT)
            .mul(BigNumber.from("10000").sub(slippage))
            .div(BigNumber.from("10000")),
        )
        .add(_underlyingTokenBalanceInVaultAfterDeposit),
    );

    // 8. check that the sandwich attack is not possible when depositing
    let value: string = "0";
    if (pool.pool == QuickswapPools["WMATIC-USDC"].pool) {
      value = "30000";
      const valueWithDecimals = BigNumber.from(value).mul(BigNumber.from("10").pow(await toTokenInstance.decimals()));
      await setTokenBalanceInStorage(toTokenInstance, this.signers.attacker.address, value);
      await toTokenInstance
        .connect(this.signers.attacker)
        .approve(this.quickswapRouter.address, valueWithDecimals, getOverrideOptions());
      await this.quickswapRouter
        .connect(this.signers.attacker)
        .swapExactTokensForTokens(
          valueWithDecimals,
          "0",
          [toTokenInstance.address, underlyingTokenInstance.address],
          this.signers.attacker.address,
          "1000000000000000000",
          getOverrideOptions(),
        );
      await expect(
        this.testDeFiAdapter.testGetDepositAllCodes(
          underlyingTokenInstance.address,
          pool.pool,
          this.quickSwapPoolAdapter.address,
          getOverrideOptions(),
        ),
      ).to.be.revertedWith("!imbalanced pool");

      // 9. check that the sandwich attack is not possible when withdrawing
      await setTokenBalanceInStorage(quickswapDepositInstance as ERC20, this.testDeFiAdapter.address, "20");
      await expect(
        this.testDeFiAdapter.testGetWithdrawAllCodes(
          underlyingTokenInstance.address,
          pool.pool,
          this.quickSwapPoolAdapter.address,
          getOverrideOptions(),
        ),
      ).to.be.revertedWith("!imbalanced pool");
    }

    // 10. non-riskOperator shouldn't be able to set tolerances
    await expect(
      this.quickSwapPoolAdapter
        .connect(this.signers.attacker)
        .setLiquidityPoolToTolerance([{ liquidityPool: "0xD75EA151a61d06868E31F8988D28DFE5E9df57B4", tolerance: 200 }]),
    ).to.be.revertedWith("caller is not the riskOperator");

    // 11. riskOperator should be able to set tolerances
    await this.quickSwapPoolAdapter
      .connect(this.signers.riskOperator)
      .setLiquidityPoolToTolerance([{ liquidityPool: "0xD75EA151a61d06868E31F8988D28DFE5E9df57B4", tolerance: 200 }]);
    expect(
      await this.quickSwapPoolAdapter.liquidityPoolToTolerance("0xD75EA151a61d06868E31F8988D28DFE5E9df57B4"),
    ).to.be.eq(200);
  }).timeout(100000);
}
