// import { createEIP712, generateKeypair } from "fhevmjs/node";
// import { createEncryptedInputMocked, reencryptRequestMocked } from "./fhevmjsMocked";
// export const getInstance = () => {
//   const instanceMocked = {
//     reencrypt: reencryptRequestMocked,
//     createEncryptedInput: createEncryptedInputMocked,
//     getPublicKey: () => "0xFFAA44433",
//     generateKeypair: generateKeypair,
//     createEIP712: createEIP712(31337),
//   };
//   return instanceMocked;
// };
import assert from "assert";
import { PublicParams, ZKInput } from "fhevmjs/lib/sdk/encrypt";
import { FhevmInstance, createEIP712, generateKeypair } from "fhevmjs/node";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { createEncryptedInputMocked, getVersion, reencryptRequestMocked } from "./fhevmjsMocked";

export async function isRunning(): Promise<boolean> {
  try {
    await getVersion();
    return true;
  } catch {
    return false;
  }
}

export const createInstance = async (hre: HardhatRuntimeEnvironment): Promise<FhevmInstance> => {
  if (hre.network.name !== "localhost") {
    throw new Error("Only supported in localhost mode");
  }
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  assert(chainId !== undefined);

  const instance: FhevmInstance = {
    reencrypt: (
      handle: bigint,
      privateKey: string,
      publicKey: string,
      signature: string,
      contractAddress: string,
      userAddress: string,
    ): Promise<bigint> => {
      return reencryptRequestMocked(
        hre,
        chainId,
        handle,
        privateKey,
        publicKey,
        signature,
        contractAddress,
        userAddress,
      );
    },
    createEncryptedInput: (contractAddress: string, userAddress: string): ZKInput => {
      return createEncryptedInputMocked(hre, chainId, contractAddress, userAddress);
    },
    getPublicKey: () => {
      const THROW = true;
      if (THROW) {
        throw new Error(`To be implemented!`);
      } else {
        //"0xFFAA44433"
        return {
          publicKeyId: "0xFFAA44433",
          publicKey: new Uint8Array(),
        };
      }
    },
    generateKeypair: generateKeypair,
    createEIP712: createEIP712(chainId),
    /* eslint-disable @typescript-eslint/no-unused-vars */
    getPublicParams: (bits: keyof PublicParams) => null,
  };
  return instance;
};
