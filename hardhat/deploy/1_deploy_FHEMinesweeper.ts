import { DeployFunction, DeployResult } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployed: DeployResult = await deploy("FHEMinesweeper", {
    contract: "FHEMinesweeper",
    from: deployer,
    args: [deployer],
    log: true,
    waitConfirmations: 1,
  });

  console.info(`✅ FHEMinesweeper contract : ${deployed.address}`);
};
export default func;
func.id = "deploy_FHEMinesweeper"; // id required to prevent reexecution
func.tags = ["FHEMinesweeper"];
