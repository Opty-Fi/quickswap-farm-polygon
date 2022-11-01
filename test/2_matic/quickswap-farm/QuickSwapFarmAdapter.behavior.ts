import hre from "hardhat";
import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { STAKING_FACTORY_ADDRESS, STAKING_FACTORY_ABI } from "./StakingRewardsFactory";
import { getOverrideOptions } from "../../utils";
import { ADDRESS, ABI } from "../quickSwapFactory";
import { TOKEN_ABI } from "../token.abi";
import { getAddress } from "ethers/lib/utils";
import { IERC20_ARTIFACT_PATH } from "../constants";

chai.use(solidity);

export function shouldBehaveLikeQuickSwapFarmAdapter(
  token1Name: string,
  token1Address: string,
  token2Name: string,
  token2Address: string,
): void {
  it(`${token1Name} - ${token2Name} Farm Test`, async function () {
    const quickSwapFactory = await hre.ethers.getContractAt(ABI, ADDRESS);

    const pool = await quickSwapFactory.getPair(token1Address, token2Address);
    const liquidityPoolInstance = await hre.ethers.getContractAt(IERC20_ARTIFACT_PATH, pool);
    const underlyingToken = pool;

    const stakingRewardsFactory = await hre.ethers.getContractAt(STAKING_FACTORY_ABI, STAKING_FACTORY_ADDRESS);
    const farmAddress = await stakingRewardsFactory.stakingRewardsInfoByStakingToken(underlyingToken);
    const liquidityPool = farmAddress[0];

    const quickTokenAddress: string = getAddress("0x831753DD7087CaC61aB5644b308642cc1c33Dc13");
    const quickTokenInstance = await hre.ethers.getContractAt(IERC20_ARTIFACT_PATH, quickTokenAddress);

    // 1. Deposit Some underlying tokens
    const token1Balance = await this.testDeFiAdapter.getERC20TokenBalance(token1Address, this.qsigners.alice.address);
    const token2Balance = await this.testDeFiAdapter.getERC20TokenBalance(token2Address, this.qsigners.alice.address);
    const token1DepositAmount = token1Balance.div(2);
    const token2DepositAmount = token2Balance.div(2);

    const token1Instance = await hre.ethers.getContractAt(TOKEN_ABI, token1Address);
    const token2Instance = await hre.ethers.getContractAt(TOKEN_ABI, token2Address);

    await token1Instance.connect(this.qsigners.alice).approve(this.uniswapV2Router02.address, token1DepositAmount);
    await token2Instance.connect(this.qsigners.alice).approve(this.uniswapV2Router02.address, token2DepositAmount);

    const block = await hre.ethers.provider.getBlock("latest");
    await this.uniswapV2Router02
      .connect(this.qsigners.alice)
      .addLiquidity(
        token1Address,
        token2Address,
        token1DepositAmount,
        token2DepositAmount,
        0,
        0,
        this.qsigners.alice.address,
        block.timestamp + 2,
        getOverrideOptions(),
      );

    // 1.1 transfer all amount of lpToken from test address to testDeFiAdapter
    let lpTokenAmount = await this.quickSwapFarmAdapter.getLiquidityPoolTokenBalance(
      this.qsigners.alice.address,
      underlyingToken,
      underlyingToken, // placeholder of type address
    );

    await liquidityPoolInstance.connect(this.qsigners.alice).transfer(this.testDeFiAdapter.address, lpTokenAmount);
    lpTokenAmount = await this.quickSwapFarmAdapter.getLiquidityPoolTokenBalance(
      this.testDeFiAdapter.address,
      underlyingToken,
      underlyingToken, // placeholder of type address
    );

    // 2. Stake all lpTokens
    const getPoolValueBeforeStake = await this.quickSwapFarmAdapter.getPoolValue(liquidityPool, underlyingToken);
    const LPTokenBalanceBeforeStake = await this.quickSwapFarmAdapter.getLiquidityPoolTokenBalance(
      this.testDeFiAdapter.address,
      underlyingToken,
      underlyingToken, // placeholder of type address
    );

    // assert whether the protocol can or not stake lpToken
    const canStake = await this.quickSwapFarmAdapter.canStake(pool);
    if (canStake) {
      // stake all lpTokens
      await this.testDeFiAdapter.testGetDepositAllCodes(
        underlyingToken,
        liquidityPool,
        this.quickSwapFarmAdapter.address,
        getOverrideOptions(),
      );
    }

    // 2.1 assert whether the pool's totalSupply is as expected or not after staking lpToken
    const getPoolValueAfterStake = await this.quickSwapFarmAdapter.getPoolValue(liquidityPool, underlyingToken);
    expect(getPoolValueAfterStake).to.be.eq(getPoolValueBeforeStake.add(LPTokenBalanceBeforeStake));

    // 2.2 assert whether the staked lpToken balance is as expected or not after staking lpToken
    const actualStakedLPTokenBalanceAfterStake = await this.quickSwapFarmAdapter.getLiquidityPoolTokenBalanceStake(
      this.testDeFiAdapter.address,
      this.testDeFiAdapter.address, // placeholder of type address
      liquidityPool,
    );
    const expectStakedLPTokenBalanceAfterStake = lpTokenAmount;
    expect(actualStakedLPTokenBalanceAfterStake).to.be.eq(expectStakedLPTokenBalanceAfterStake);

    // 2.3 make a transaction for mining a block to get finite unclaimed reward amount
    await this.qsigners.admin.sendTransaction({
      value: hre.ethers.utils.parseEther("0"),
      to: await this.qsigners.admin.getAddress(),
      ...getOverrideOptions(),
    });

    // Coverage Test
    // 2.4 assert whether the underlyingToken balance is as expected or not before claim
    const expectUnderlyingTokenBalanceBeforeClaim = await this.quickSwapFarmAdapter.getAllAmountInToken(
      this.testDeFiAdapter.address,
      token1Address,
      liquidityPool,
    );
    const actualUnderlyingTokenBalanceBeforeClaim = await this.testDeFiAdapter.getERC20TokenBalance(
      token1Address,
      this.testDeFiAdapter.address,
    );
    expect(expectUnderlyingTokenBalanceBeforeClaim).to.be.eq(actualUnderlyingTokenBalanceBeforeClaim);

    // 3. Claim the reward token
    await this.testDeFiAdapter.testClaimRewardTokenCode(
      liquidityPool,
      this.quickSwapFarmAdapter.address,
      getOverrideOptions(),
    );

    // 3.1 assert whether the reward token's balance is as expected or not after claiming
    const actualRewardTokenBalanceAfterClaim = await this.testDeFiAdapter.getERC20TokenBalance(
      quickTokenAddress,
      this.testDeFiAdapter.address,
    );
    const expectedRewardTokenBalanceAfterClaim = await quickTokenInstance.balanceOf(this.testDeFiAdapter.address);
    expect(actualRewardTokenBalanceAfterClaim).to.be.eq(expectedRewardTokenBalanceAfterClaim);

    // 3.2 underlying token balance
    const expectUnderlyingTokenBalanceAfterHarvest = await this.quickSwapFarmAdapter.getAllAmountInToken(
      this.testDeFiAdapter.address,
      token1Address,
      liquidityPool,
    );

    // 3.3 Coverage Test
    if (Number(expectUnderlyingTokenBalanceAfterHarvest) > 0) {
      const isRedeemableAmountSufficient = await this.quickSwapFarmAdapter.isRedeemableAmountSufficient(
        this.testDeFiAdapter.address,
        token1Address,
        liquidityPool,
        expectUnderlyingTokenBalanceAfterHarvest.div(2),
      );
      if (isRedeemableAmountSufficient) {
        await this.quickSwapFarmAdapter.calculateRedeemableLPTokenAmount(
          this.testDeFiAdapter.address,
          token1Address,
          liquidityPool,
          expectUnderlyingTokenBalanceAfterHarvest.div(2),
        );
      }
    }

    // 4. Swap the reward token into underlying token
    await this.testDeFiAdapter.testGetHarvestAllCodes(
      liquidityPool,
      token1Address,
      this.quickSwapFarmAdapter.address,
      getOverrideOptions(),
    );

    // 4.1 assert whether all reward token is swapped or not
    const actualRewardTokenBalanceAfterHarvest = await this.testDeFiAdapter.getERC20TokenBalance(
      quickTokenAddress,
      this.testDeFiAdapter.address,
    );

    expect(actualRewardTokenBalanceAfterHarvest).to.be.gte(0);

    // 4.2 assert whether the reward token is swapped to underlying token or not
    const actualUnderlyingTokenBalanceAfterHarvest = await this.testDeFiAdapter.getERC20TokenBalance(
      token1Address,
      this.testDeFiAdapter.address,
    );

    expect(expectUnderlyingTokenBalanceAfterHarvest).to.be.eq(actualUnderlyingTokenBalanceAfterHarvest);

    // 5. Unstake all staked lpTokens
    const expectedLPTokenBalanceAfterUnstake = await this.quickSwapFarmAdapter.getLiquidityPoolTokenBalanceStake(
      this.testDeFiAdapter.address,
      this.testDeFiAdapter.address, // placeholder of type address
      liquidityPool,
    );
    const LPTokenBalanceBeforeUnstake = await this.quickSwapFarmAdapter.getLiquidityPoolTokenBalance(
      this.testDeFiAdapter.address,
      underlyingToken,
      underlyingToken, // placeholder of type address
    );

    await this.testDeFiAdapter.testGetWithdrawAllCodes(
      underlyingToken,
      liquidityPool,
      this.quickSwapFarmAdapter.address,
      getOverrideOptions(),
    );

    // 5.1 assert whether staked lpToken balance is as expected or not
    const LPTokenBalanceAfterUnstake = await this.quickSwapFarmAdapter.getLiquidityPoolTokenBalance(
      this.testDeFiAdapter.address,
      underlyingToken,
      underlyingToken, // placeholder of type address
    );
    const actualLPTokenBalanceAfterUnstake = LPTokenBalanceAfterUnstake.sub(LPTokenBalanceBeforeUnstake);

    expect(expectedLPTokenBalanceAfterUnstake).to.be.eq(actualLPTokenBalanceAfterUnstake);

    // 6. Coverage Test True case
    // 6.1 assert whether underlying token's address is correct or not
    const underlyingTokens = await this.quickSwapFarmAdapter.getUnderlyingTokens(
      // get lpToken address
      await this.quickSwapFarmAdapter.getLiquidityPoolToken(
        underlyingToken, // placeholder of type address
        underlyingToken,
      ),
      liquidityPool, // placeholder of type address
    );
    if (token1Address.toString() < token2Address.toString()) {
      expect(underlyingTokens[0]).to.be.eq(token1Address);
      expect(underlyingTokens[1]).to.be.eq(token2Address);
    } else {
      expect(underlyingTokens[0]).to.be.eq(token2Address);
      expect(underlyingTokens[1]).to.be.eq(token1Address);
    }

    // 6.2 calculateAmountInLPToken
    const calculateAmountInLPToken = await this.quickSwapFarmAdapter.calculateAmountInLPToken(
      liquidityPool, // placeholder of type address
      underlyingToken, // placeholder of type address
      100,
    );
    expect(calculateAmountInLPToken).to.be.eq(100);

    // call getAddLiquidityCodes function
    await this.quickSwapFarmAdapter.getAddLiquidityCodes(this.testDeFiAdapter.address, underlyingToken);
    // assert whether deposit code when lpToken amount is 0
    await this.testDeFiAdapter.testGetDepositSomeCodes(
      underlyingToken,
      liquidityPool,
      this.quickSwapFarmAdapter.address,
      0,
      getOverrideOptions(),
    );
    // assert whether harvest code when rewardToken amount is 0
    await this.testDeFiAdapter.testGetHarvestSomeCodes(
      liquidityPool,
      underlyingToken,
      this.quickSwapFarmAdapter.address,
      0,
      getOverrideOptions(),
    );
    // assert whether withdraw code when lpToken amount is 0
    await this.testDeFiAdapter.testGetWithdrawSomeCodes(
      underlyingToken,
      liquidityPool,
      this.quickSwapFarmAdapter.address,
      0,
      getOverrideOptions(),
    );
  }).timeout(100000);
}
