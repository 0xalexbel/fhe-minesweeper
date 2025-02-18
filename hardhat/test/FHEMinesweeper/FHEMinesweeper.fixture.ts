import { ethers } from "hardhat";

import type { FHEMinesweeperMock } from "../../types";
import { getSigners } from "../signers";

export async function deployFHEMinesweeperFixture(): Promise<FHEMinesweeperMock> {
  const signers = await getSigners();

  const contractFactory = await ethers.getContractFactory("FHEMinesweeperMock");
  const contract = await contractFactory.connect(signers.alice).deploy(signers.alice);
  await contract.waitForDeployment();

  return contract;
}
