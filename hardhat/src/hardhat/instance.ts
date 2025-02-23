import assert from "assert";
import { PublicParams, ZKInput } from "fhevmjs/lib/sdk/encrypt";
import { FhevmInstance, createEIP712, createInstance as createFhevmInstance, generateKeypair } from "fhevmjs/node";
import { HardhatRuntimeEnvironment, HttpNetworkConfig } from "hardhat/types";

import { ACL_ADDRESS, GATEWAY_URL, KMSVERIFIER_ADDRESS } from "../constants";
import { createEncryptedInputMocked, reencryptRequestMocked } from "./fhevmjsMocked";

export const createInstance = async (hre: HardhatRuntimeEnvironment): Promise<FhevmInstance> => {
  if (hre.network.name === "hardhat" || hre.network.name === "localhost") {
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
  } else {
    const networkUrl = (hre.network.config as HttpNetworkConfig).url;
    const instance = await createFhevmInstance({
      kmsContractAddress: KMSVERIFIER_ADDRESS,
      aclContractAddress: ACL_ADDRESS,
      networkUrl,
      gatewayUrl: GATEWAY_URL,
    });
    return instance;
  }
};
