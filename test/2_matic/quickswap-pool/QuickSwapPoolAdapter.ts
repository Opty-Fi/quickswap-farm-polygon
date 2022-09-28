import hre from "hardhat";
import { Artifact } from "hardhat/types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { default as QuickswapPools } from "../../../helpers/quickswap_pools_small_test_list.json";
import { OptyFiOracle, QuickSwapPoolAdapter, TestDeFiAdapter } from "../../../typechain";
import { LiquidityPool, Signers } from "../types";
import { shouldBehaveLikeQuickSwapPoolAdapter } from "./QuickSwapPoolAdapter.behavior";
import { IUniswapV2Router02 } from "../../../typechain";
import { getOverrideOptions } from "../../utils";
import tokens from "../../../helpers/tokens.json";
import underlyingTokens from "../../../helpers/underlyingTokens.json";

const { deployContract } = hre.waffle;

describe("Unit tests", function () {
  before(async function () {
    this.signers = {} as Signers;
    const signers: SignerWithAddress[] = await hre.ethers.getSigners();
    this.signers.owner = signers[0];
    this.signers.deployer = signers[1];
    this.signers.attacker = signers[2];
    this.signers.riskOperator = signers[3];

    // get the UniswapV2Router contract instance
    this.quickswapRouter = <IUniswapV2Router02>(
      await hre.ethers.getContractAt("IUniswapV2Router02", "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff")
    );

    const registryArtifact: Artifact = await hre.artifacts.readArtifact("IAdapterRegistryBase");
    const mockRegistry = await hre.waffle.deployMockContract(this.signers.deployer, registryArtifact.abi);
    await mockRegistry.mock.getRiskOperator.returns(this.signers.riskOperator.address);

    // deploy OptyFi Oracle
    const OptyFiOracleArtifact: Artifact = await hre.artifacts.readArtifact("OptyFiOracle");
    this.optyFiOracle = <OptyFiOracle>(
      await deployContract(this.signers.owner, OptyFiOracleArtifact, ["3600", "3600"], getOverrideOptions())
    );

    // deploy Quickswap Pools Adapter
    const QuickSwapPoolAdapterArtifact: Artifact = await hre.artifacts.readArtifact("QuickSwapPoolAdapter");
    this.quickSwapPoolAdapter = <QuickSwapPoolAdapter>(
      await deployContract(
        this.signers.deployer,
        QuickSwapPoolAdapterArtifact,
        [mockRegistry.address, this.optyFiOracle.address],
        getOverrideOptions(),
      )
    );

    const WMATIC_USD_FEED = "0xAB594600376Ec9fD91F8e885dADF0CE036862dE0";
    const USDC_USD_FEED = "0xfE4A8cc5b5B2366C1B58Bea3858e81843581b2F7";

    const feedToTokens = [
      {
        priceFeed: WMATIC_USD_FEED,
        tokenA: tokens.WMATIC,
        tokenB: tokens.USD,
      },
      {
        priceFeed: USDC_USD_FEED,
        tokenA: tokens.USDC,
        tokenB: tokens.USD,
      },
    ];

    let tx = await this.optyFiOracle.connect(this.signers.owner).setChainlinkPriceFeed(feedToTokens);
    await tx.wait(1);

    const chainlinkTimeallowances = [
      { tokenA: tokens.WMATIC, tokenB: tokens.USD, timeAllowance: "43200" },
      { tokenA: tokens.USDC, tokenB: tokens.USD, timeAllowance: "43200" },
    ];

    tx = await this.optyFiOracle.connect(this.signers.owner).setChainlinkTimeAllowance(chainlinkTimeallowances);
    await tx.wait(1);

    // deploy TestDeFiAdapter Contract
    const testDeFiAdapterArtifact: Artifact = await hre.artifacts.readArtifact("TestDeFiAdapter");
    this.testDeFiAdapter = <TestDeFiAdapter>(
      await deployContract(this.signers.deployer, testDeFiAdapterArtifact, [], getOverrideOptions())
    );
  });

  describe("QuickSwapPoolAdapter", function () {
    Object.keys(QuickswapPools).map((poolName: string) => {
      const pairUnderlyingTokens = [
        (QuickswapPools as LiquidityPool)[poolName].token0,
        (QuickswapPools as LiquidityPool)[poolName].token1,
      ];
      for (const pairUnderlyingToken of pairUnderlyingTokens) {
        if (Object.values(underlyingTokens).includes(pairUnderlyingToken)) {
          for (const key of Object.keys(underlyingTokens)) {
            if ((underlyingTokens[key as keyof typeof underlyingTokens] as string) == pairUnderlyingToken) {
              shouldBehaveLikeQuickSwapPoolAdapter(key, poolName, (QuickswapPools as LiquidityPool)[poolName]);
            }
          }
        }
      }
    });
  });
});
