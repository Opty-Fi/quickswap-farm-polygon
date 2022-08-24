import { TransactionRequest } from "@ethersproject/providers";
import hre, { ethers } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ERC20 } from "../typechain";
import { IUniswapV2Router02 } from "../typechain/IUniswapV2Router02";
import tokens from "../helpers/tokens.json";
import { parseUnits } from "ethers/lib/utils";

export function getOverrideOptions(): TransactionRequest {
  return {
    gasPrice: 1_000_000_00,
  };
}

export async function getBlockTimestamp(hre: HardhatRuntimeEnvironment): Promise<number> {
  const blockNumber = await hre.ethers.provider.getBlockNumber();
  const block = await hre.ethers.provider.getBlock(blockNumber);
  const timestamp = block.timestamp;
  return timestamp;
}

const setStorageAt = (address: string, slot: string, val: string) =>
  hre.network.provider.send("hardhat_setStorageAt", [address, slot, val]);

const tokenBalancesSlot = async (token: ERC20) => {
  const val: string = "0x" + "12345".padStart(64, "0");
  const account: string = ethers.constants.AddressZero;

  for (let i = 0; i < 100; i++) {
    let slot = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(["address", "uint256"], [account, i]));
    while (slot.startsWith("0x0")) slot = "0x" + slot.slice(3);

    const prev = await hre.network.provider.send("eth_getStorageAt", [account, slot, "latest"]);
    await setStorageAt(token.address, slot, val);
    const balance = await token.balanceOf(account);
    await setStorageAt(token.address, slot, prev);
    if (balance.eq(ethers.BigNumber.from(val))) {
      return { index: i, isVyper: false };
    }
  }

  for (let i = 0; i < 100; i++) {
    let slot = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(["uint256", "address"], [i, account]));
    while (slot.startsWith("0x0")) slot = "0x" + slot.slice(3);

    const prev = await hre.network.provider.send("eth_getStorageAt", [account, slot, "latest"]);
    await setStorageAt(token.address, slot, val);
    const balance = await token.balanceOf(account);
    await setStorageAt(token.address, slot, prev);
    if (balance.eq(ethers.BigNumber.from(val))) {
      return { index: i, isVyper: true };
    }
  }
  throw "balances slot not found!";
};

// Source : https://blog.euler.finance/brute-force-storage-layout-discovery-in-erc20-contracts-with-hardhat-7ff9342143ed
export async function setTokenBalanceInStorage(token: ERC20, account: string, amount: string) {
  try {
    const balancesSlot = await tokenBalancesSlot(token);
    if (balancesSlot.isVyper) {
      return setStorageAt(
        token.address,
        ethers.utils.keccak256(
          ethers.utils.defaultAbiCoder.encode(["uint256", "address"], [balancesSlot.index, account]),
        ),
        "0x" +
          ethers.utils
            .parseUnits(amount, await token.decimals())
            .toHexString()
            .slice(2)
            .padStart(64, "0"),
      );
    } else {
      return setStorageAt(
        token.address,
        ethers.utils.hexStripZeros(
          ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(["address", "uint256"], [account, balancesSlot.index]),
          ),
        ),
        "0x" +
          ethers.utils
            .parseUnits(amount, await token.decimals())
            .toHexString()
            .slice(2)
            .padStart(64, "0"),
      );
    }
  } catch (e) {
    if (e === "balances slot not found!") {
      const timestamp = (await getBlockTimestamp(hre)) * 2;
      const sushiswapRouter = <IUniswapV2Router02>(
        await ethers.getContractAt("IUniswapV2Router02", "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F")
      );

      const tx = await sushiswapRouter.swapETHForExactTokens(
        ethers.utils.parseUnits(amount, await token.decimals()),
        [tokens.WMATIC, token.address],
        account,
        timestamp,
        {
          value: parseUnits("9"),
        },
      );
      await tx.wait(1);
    } else {
      throw e;
    }
  }
}
