import { FhevmInstance } from "fhevmjs/node";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { FHEMinesweeperError } from "../tasks/error";

export enum FhevmInstanceType {
  HARDHAT = 1,
  MOCK = 2,
  SEPOLIA = 3,
}

export async function detectFhevmType(hre: HardhatRuntimeEnvironment): Promise<FhevmInstanceType> {
  try {
    if (hre.network.name === "sepolia") {
      // sepolia
      return FhevmInstanceType.SEPOLIA;
    } else if (hre.network.name === "hardhat") {
      // pure hardhat
      return FhevmInstanceType.HARDHAT;
    } else if (hre.network.name === "localhost") {
      const mockedFhevm = await import("./mock/instance");
      const is_mock = await mockedFhevm.isRunning();
      if (is_mock) {
        // hardhat node + mock gateway server
        return FhevmInstanceType.MOCK;
      } else {
        // Pure hardhat node
        return FhevmInstanceType.HARDHAT;
      }
    }
  } catch (error) {
    throw new FHEMinesweeperError("Unsupported network", undefined, error as Error);
  }

  throw new FHEMinesweeperError(`Unsupported network ${hre.network.name}`);
}

export async function createInstance(hre: HardhatRuntimeEnvironment): Promise<FhevmInstance> {
  const fhevmType = await detectFhevmType(hre);
  let fhevm: FhevmInstance | undefined;
  try {
    switch (fhevmType) {
      case FhevmInstanceType.HARDHAT: {
        const hhFhevm = await import("./hardhat/instance");
        fhevm = await hhFhevm.createInstance(hre);
        break;
      }
      case FhevmInstanceType.MOCK: {
        const mockedFhevm = await import("./mock/instance");
        fhevm = await mockedFhevm.createInstance(hre);
        break;
      }
      case FhevmInstanceType.SEPOLIA: {
        const sepoliaFhevm = await import("./sepolia/instance");
        fhevm = await sepoliaFhevm.createInstance(hre);
        break;
      }
      default: {
        break;
      }
    }
  } catch (error) {
    throw new FHEMinesweeperError("Unsupported network", undefined, error as Error);
  }

  if (!fhevm) {
    throw new FHEMinesweeperError(`Unsupported network ${hre.network.name}`);
  }

  return fhevm;
}

export async function initGateway(hre: HardhatRuntimeEnvironment, autoDecryptIntervalMS?: number) {
  const fhevmType = await detectFhevmType(hre);
  switch (fhevmType) {
    case FhevmInstanceType.HARDHAT: {
      const hhFhevm = await import("../src/hardhat/asyncDecrypt");
      await hhFhevm.initGateway(hre, autoDecryptIntervalMS);
      break;
    }
    case FhevmInstanceType.MOCK:
    case FhevmInstanceType.SEPOLIA: {
      // No gateway to initialize
      break;
    }
  }
}

export async function closeGateway(hre: HardhatRuntimeEnvironment) {
  const fhevmType = await detectFhevmType(hre);
  switch (fhevmType) {
    case FhevmInstanceType.HARDHAT: {
      const hhFhevm = await import("../src/hardhat/asyncDecrypt");
      await hhFhevm.closeGateway(hre);
      break;
    }
    case FhevmInstanceType.MOCK:
    case FhevmInstanceType.SEPOLIA: {
      // No gateway to close
      break;
    }
  }
}
