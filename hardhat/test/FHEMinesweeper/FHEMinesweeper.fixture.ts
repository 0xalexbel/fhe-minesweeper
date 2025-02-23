import { ethers } from "hardhat";

import type { FHEMinesweeper, FHEMinesweeperMock } from "../../types";
import { getSigners } from "../signers";

export async function deployFHEMinesweeperMockFixture(): Promise<FHEMinesweeperMock> {
  const signers = await getSigners();

  const contractFactory = await ethers.getContractFactory("FHEMinesweeperMock");
  const contract = await contractFactory.connect(signers.alice).deploy(signers.alice);
  await contract.waitForDeployment();

  return contract;
}

export async function deployFHEMinesweeperFixture(): Promise<FHEMinesweeper> {
  const signers = await getSigners();

  const contractFactory = await ethers.getContractFactory("FHEMinesweeper");
  const contract = await contractFactory.connect(signers.alice).deploy(signers.alice);
  await contract.waitForDeployment();

  return contract;
}
