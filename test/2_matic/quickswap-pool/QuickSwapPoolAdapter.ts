import hre from "hardhat";
import { Artifact } from "hardhat/types";
import { getAddress } from "ethers/lib/utils";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { IUniswapV2Router02, QuickSwapPoolAdapter } from "../../../typechain";
import { TestDeFiAdapter } from "../../../typechain/TestDeFiAdapter";
import { getOverrideOptions } from "../../utils";
import { Signers } from "../types";
import { shouldBehaveLikeQuickSwapPoolAdapter } from "./QuickSwapPoolAdapter.behavior";
import { USD, BTC } from "../token.address";
import { IERC20_ARTIFACT_PATH } from "../constants";

const { deployContract } = hre.waffle;

describe("Unit tests", function () {
  before(async function () {
    this.qsigners = {} as Signers;
    const DAI_ADDRESS: string = getAddress("0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063");
    const USDT_ADDRESS: string = getAddress("0xc2132D05D31c914a87C6611C10748AEb04B58e8F");
    const USDC_ADDRESS: string = getAddress("0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174");
    const WBTC_ADDRESS: string = getAddress("0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6");
    const PBTC_ADDRESS: string = getAddress("0xd7ecf95Cf7eF5256990BeAf4ac895cD9e64cb947");

    const DAI_WHALE: string = getAddress("0x0d0707963952f2fba59dd06f2b425ace40b492fe");
    const USDT_WHALE: string = getAddress("0x0d0707963952f2fba59dd06f2b425ace40b492fe");
    const USDC_WHALE: string = getAddress("0x0d0707963952f2fba59dd06f2b425ace40b492fe");
    const WBTC_WHALE: string = getAddress("0x5fdaef0a0b11774db68c38ab36957de8646af1b5");
    const PBTC_WHALE: string = getAddress("0x5fdaef0a0b11774db68c38ab36957de8646af1b5");

    const signers: SignerWithAddress[] = await hre.ethers.getSigners();

    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [DAI_WHALE],
    });
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [USDT_WHALE],
    });
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [USDC_WHALE],
    });
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [WBTC_WHALE],
    });
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [PBTC_WHALE],
    });
    this.qsigners.admin = signers[0];
    this.qsigners.owner = signers[1];
    this.qsigners.deployer = signers[2];
    this.qsigners.alice = signers[3];
    this.qsigners.operator = signers[4];
    this.qsigners.riskOperator = signers[5];
    this.qsigners.daiWhale = await hre.ethers.getSigner(DAI_WHALE);
    this.qsigners.usdtWhale = await hre.ethers.getSigner(USDT_WHALE);
    this.qsigners.usdcWhale = await hre.ethers.getSigner(USDC_WHALE);
    this.qsigners.wbtcWhale = await hre.ethers.getSigner(WBTC_WHALE);
    this.qsigners.pbtcWhale = await hre.ethers.getSigner(PBTC_WHALE);
    const dai = await hre.ethers.getContractAt(IERC20_ARTIFACT_PATH, DAI_ADDRESS, this.qsigners.daiWhale);
    const usdt = await hre.ethers.getContractAt(IERC20_ARTIFACT_PATH, USDT_ADDRESS, this.qsigners.usdtWhale);
    const usdc = await hre.ethers.getContractAt(IERC20_ARTIFACT_PATH, USDC_ADDRESS, this.qsigners.usdcWhale);
    const wbtc = await hre.ethers.getContractAt(IERC20_ARTIFACT_PATH, WBTC_ADDRESS, this.qsigners.wbtcWhale);
    const pbtc = await hre.ethers.getContractAt(IERC20_ARTIFACT_PATH, PBTC_ADDRESS, this.qsigners.pbtcWhale);
    // get the UniswapV2Router contract instance
    this.uniswapV2Router02 = <IUniswapV2Router02>(
      await hre.ethers.getContractAt("IUniswapV2Router02", "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff")
    );

    // deploy TestDeFiAdapter Contract
    const testDeFiAdapterArtifact: Artifact = await hre.artifacts.readArtifact("TestDeFiAdapter");
    this.testDeFiAdapter = <TestDeFiAdapter>(
      await deployContract(this.qsigners.deployer, testDeFiAdapterArtifact, [], getOverrideOptions())
    );

    const registryArtifact: Artifact = await hre.artifacts.readArtifact("IAdapterRegistryBase");
    this.mockRegistry = await hre.waffle.deployMockContract(this.qsigners.deployer, registryArtifact.abi);
    await this.mockRegistry.mock.getOperator.returns(this.qsigners.operator.address);
    await this.mockRegistry.mock.getRiskOperator.returns(this.qsigners.riskOperator.address);

    // deploy QuickSwap Finance Adapter
    const quickSwapAdapterArtifact: Artifact = await hre.artifacts.readArtifact("QuickSwapPoolAdapter");
    this.quickSwapPoolAdapter = <QuickSwapPoolAdapter>(
      await deployContract(
        this.qsigners.deployer,
        quickSwapAdapterArtifact,
        [this.mockRegistry.address],
        getOverrideOptions(),
      )
    );

    // fund the whale's wallet with gas
    await this.qsigners.admin.sendTransaction({
      to: DAI_WHALE,
      value: hre.ethers.utils.parseEther("1"),
      ...getOverrideOptions(),
    });
    await this.qsigners.admin.sendTransaction({
      to: WBTC_WHALE,
      value: hre.ethers.utils.parseEther("1"),
      ...getOverrideOptions(),
    });

    // fund TestDeFiAdapter with USD and BTC
    await dai.transfer(this.testDeFiAdapter.address, hre.ethers.utils.parseEther("10000"), getOverrideOptions());
    await usdc.transfer(this.testDeFiAdapter.address, hre.ethers.utils.parseUnits("10000", 6), getOverrideOptions());
    await usdt.transfer(this.testDeFiAdapter.address, hre.ethers.utils.parseUnits("10000", 6), getOverrideOptions());
    await wbtc.transfer(this.testDeFiAdapter.address, hre.ethers.utils.parseUnits("0.1", 8), getOverrideOptions());
    await pbtc.transfer(this.testDeFiAdapter.address, hre.ethers.utils.parseEther("0.1"), getOverrideOptions());
  });

  describe("QuickSwapPoolAdapter", function () {
    for (let i = 0; i < USD.length - 1; i++) {
      for (let j = i + 1; j < USD.length; j++) {
        shouldBehaveLikeQuickSwapPoolAdapter(
          USD[i].name,
          USD[i].address,
          USD[j].name,
          USD[j].address,
          USD[i].name,
          USD[i].address,
        );
        shouldBehaveLikeQuickSwapPoolAdapter(
          USD[i].name,
          USD[i].address,
          USD[j].name,
          USD[j].address,
          USD[j].name,
          USD[j].address,
        );
      }
    }

    for (let i = 0; i < BTC.length - 1; i++) {
      for (let j = i + 1; j < BTC.length; j++) {
        shouldBehaveLikeQuickSwapPoolAdapter(
          BTC[i].name,
          BTC[i].address,
          BTC[j].name,
          BTC[j].address,
          BTC[i].name,
          BTC[i].address,
        );
        shouldBehaveLikeQuickSwapPoolAdapter(
          BTC[i].name,
          BTC[i].address,
          BTC[j].name,
          BTC[j].address,
          BTC[j].name,
          BTC[j].address,
        );
      }
    }
  });
});
