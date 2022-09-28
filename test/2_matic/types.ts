import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { Fixture } from "ethereum-waffle";
import { QuickSwapPoolAdapter } from "../../typechain/QuickSwapPoolAdapter";
import { QuickSwapFarmAdapter } from "../../typechain/QuickSwapFarmAdapter";
import { IUniswapV2Router02 } from "../../typechain/IUniswapV2Router02";
import { TestDeFiAdapter } from "../../typechain/TestDeFiAdapter";
import { OptyFiOracle } from "../../typechain/OptyFiOracle";

export interface Signers {
  admin: SignerWithAddress;
  owner: SignerWithAddress;
  operator: SignerWithAddress;
  riskOperator: SignerWithAddress;
  deployer: SignerWithAddress;
  alice: SignerWithAddress;
  bob: SignerWithAddress;
  charlie: SignerWithAddress;
  dave: SignerWithAddress;
  eve: SignerWithAddress;
  daiWhale: SignerWithAddress;
  usdtWhale: SignerWithAddress;
  usdcWhale: SignerWithAddress;
  pbtcWhale: SignerWithAddress;
  wbtcWhale: SignerWithAddress;
}

export interface PoolItem {
  pool: string;
  token0: string;
  token1: string;
  deprecated?: boolean;
  slippage: number;
}

export interface LiquidityPool {
  [name: string]: PoolItem;
}

declare module "mocha" {
  export interface Context {
    quickSwapPoolAdapter: QuickSwapPoolAdapter;
    quickSwapFarmAdapter: QuickSwapFarmAdapter;
    testDeFiAdapter: TestDeFiAdapter;
    quickswapRouter: IUniswapV2Router02;
    optyFiOracle: OptyFiOracle;
    loadFixture: <T>(fixture: Fixture<T>) => Promise<T>;
    qsigners: Signers;
  }
}
