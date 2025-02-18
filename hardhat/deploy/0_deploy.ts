import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, getOrNull } = hre.deployments;

  // Check if contract was previously deployed
  const existingDeployment = await getOrNull("FHEMinesweeper");
  const isNewDeployment = !existingDeployment;

  const deployed = await deploy("FHEMinesweeper", {
    from: deployer,
    args: [deployer],
    log: true,
  });

  console.log(`FHEMinesweeper contract: `, deployed.address);
  if (isNewDeployment) {
    // const signers = await hre.ethers.getSigners();
    // const alice = signers[0];
  }
};
export default func;
func.id = "deploy_FHEMinesweeper"; // id required to prevent reexecution
func.tags = ["FHEMinesweeper"];
