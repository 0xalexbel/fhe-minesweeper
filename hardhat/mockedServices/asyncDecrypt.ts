/*eslint-disable @typescript-eslint/ban-ts-comment */
import assert from "assert";
import { ethers as EthersT } from "ethers";
import aclArtifact from "fhevm-core-contracts/artifacts/contracts/ACL.sol/ACL.json";
import gatewayArtifact from "fhevm-core-contracts/artifacts/gateway/GatewayContract.sol/GatewayContract.json";

import { ACL_ADDRESS, GATEWAYCONTRACT_ADDRESS, KMSVERIFIER_ADDRESS, PRIVATE_KEY_KMS_SIGNER } from "../src/constants";
import { awaitCoprocessor, getClearText } from "./coprocessorUtils";

const aclAdd = ACL_ADDRESS;

const CiphertextType = {
  0: "bool",
  1: "uint8", // corresponding to euint4
  2: "uint8", // corresponding to euint8
  3: "uint16",
  4: "uint32",
  5: "uint64",
  6: "uint128",
  7: "address",
  8: "uint256",
  9: "bytes",
  10: "bytes",
  11: "bytes",
};

const currentTime = (): string => {
  const now = new Date();
  return now.toLocaleTimeString("en-US", { hour12: true, hour: "numeric", minute: "numeric", second: "numeric" });
};

// const argEvents =
//   "(uint256 indexed requestID, uint256[] cts, address contractCaller, bytes4 callbackSelector, uint256 msgValue, uint256 maxTimestamp, bool passSignaturesToCaller)";
//const ifaceEventDecryption = new EthersT.Interface(["event EventDecryption" + argEvents]);

//let provider: EthersT.WebSocketProvider;
//let provider: EthersT.JsonRpcProvider;
// let provider: EthersT.JsonRpcApiProvider;
type AsyncDecryptRuntime = {
  acl: EthersT.Contract;
  gateway: EthersT.Contract;
  requestDB: Set<bigint>;
  jsonRpcApiProvider: EthersT.JsonRpcApiProvider;
};

// const asyncDecryptRuntime: AsyncDecryptRuntime = {
//   acl: undefined,
//   gateway: undefined,
//   requestDB: new Set<BigInt>(),
//   jsonRpcApiProvider: undefined,
// };

// const provider = new EthersT.WebSocketProvider("ws://127.0.0.1:8545");
// const acl = new EthersT.Contract(ACL_ADDRESS, aclArtifact.abi, provider);
// const gateway = new EthersT.Contract(GATEWAYCONTRACT_ADDRESS, gatewayArtifact.abi, provider);
export function createAsyncDecryptRuntime(): AsyncDecryptRuntime {
  const jsonRpcApiProvider = new EthersT.WebSocketProvider("ws://127.0.0.1:8545");
  return {
    jsonRpcApiProvider,
    acl: new EthersT.Contract(ACL_ADDRESS, aclArtifact.abi, jsonRpcApiProvider),
    gateway: new EthersT.Contract(GATEWAYCONTRACT_ADDRESS, gatewayArtifact.abi, jsonRpcApiProvider),
    requestDB: new Set<bigint>(),
  };

  // asyncDecryptRuntime.jsonRpcApiProvider = new EthersT.WebSocketProvider("ws://127.0.0.1:8545");
  // //provider = new MyWebSocketProvider("ws://127.0.0.1:8545");
  // //provider = new EthersT.WebSocketProvider("ws://127.0.0.1:8545", undefined, { polling: true, pollingInterval: 2000 });
  // //provider = new EthersT.JsonRpcProvider("http://127.0.0.1:8545", undefined, { polling: true, pollingInterval: 2000 });
  // asyncDecryptRuntime.acl = new EthersT.Contract(ACL_ADDRESS, aclArtifact.abi, asyncDecryptRuntime.jsonRpcApiProvider);
  // asyncDecryptRuntime.gateway = new EthersT.Contract(
  //   GATEWAYCONTRACT_ADDRESS,
  //   gatewayArtifact.abi,
  //   asyncDecryptRuntime.jsonRpcApiProvider,
  // );
}

export const initGateway = async (asyncDecryptRuntime: AsyncDecryptRuntime): Promise<void> => {
  // asyncDecryptRuntime.jsonRpcApiProvider = new EthersT.WebSocketProvider("ws://127.0.0.1:8545");
  // //provider = new MyWebSocketProvider("ws://127.0.0.1:8545");
  // //provider = new EthersT.WebSocketProvider("ws://127.0.0.1:8545", undefined, { polling: true, pollingInterval: 2000 });
  // //provider = new EthersT.JsonRpcProvider("http://127.0.0.1:8545", undefined, { polling: true, pollingInterval: 2000 });
  // asyncDecryptRuntime.acl = new EthersT.Contract(ACL_ADDRESS, aclArtifact.abi, asyncDecryptRuntime.jsonRpcApiProvider);
  // asyncDecryptRuntime.gateway = new EthersT.Contract(
  //   GATEWAYCONTRACT_ADDRESS,
  //   gatewayArtifact.abi,
  //   asyncDecryptRuntime.jsonRpcApiProvider,
  // );

  asyncDecryptRuntime.gateway.on("EventDecryption", async (requestID, cts) => {
    console.log(`${currentTime()} - Requested decrypt (requestID ${requestID}) for handles ${cts}`);
    await fulfillRequest(asyncDecryptRuntime, requestID, cts);
  });

  // await provider.send("evm_setAutomine", [false]);
  // await provider.send("evm_setIntervalMining", [1000]);
};

const allTrue = (arr: boolean[], fn = Boolean) => arr.every(fn);

const fulfillRequest = async (asyncDecryptRuntime: AsyncDecryptRuntime, requestID: bigint, handles: bigint[]) => {
  const jsonRpcApiProvider = asyncDecryptRuntime.jsonRpcApiProvider!;
  const acl = asyncDecryptRuntime.acl!;
  const gateway = asyncDecryptRuntime.gateway!;

  if (asyncDecryptRuntime.requestDB.has(requestID)) {
    console.error("=============================================");
    console.error(`Gateway server: REQUEST ID = ${requestID} already processed`);
    console.error("=============================================");
    return;
  }
  asyncDecryptRuntime.requestDB.add(requestID);

  await awaitCoprocessor(jsonRpcApiProvider);

  const typesList = handles.map((handle) => parseInt(handle.toString(16).slice(-4, -2), 16));

  const isAllowedForDec = await Promise.all(handles.map(async (handle) => acl.isAllowedForDecryption(handle)));
  if (!allTrue(isAllowedForDec)) {
    throw new Error("Some handle is not authorized for decryption");
  }

  const types = typesList.map((num) => CiphertextType[num as keyof typeof CiphertextType]);
  const values = await Promise.all(handles.map(async (handle) => BigInt(await getClearText(handle))));
  const valuesFormatted = values.map((value, index) =>
    types[index] === "address" ? "0x" + value.toString(16).padStart(40, "0") : value,
  );
  const valuesFormatted2 = valuesFormatted.map((value, index) =>
    typesList[index] === 9 ? "0x" + value.toString(16).padStart(128, "0") : value,
  );
  const valuesFormatted3 = valuesFormatted2.map((value, index) =>
    typesList[index] === 10 ? "0x" + value.toString(16).padStart(256, "0") : value,
  );
  const valuesFormatted4 = valuesFormatted3.map((value, index) =>
    typesList[index] === 11 ? "0x" + value.toString(16).padStart(512, "0") : value,
  );

  const abiCoder = new EthersT.AbiCoder();

  const encodedData = abiCoder.encode(["uint256", ...types], [31, ...valuesFormatted4]); // 31 is just a dummy uint256 requestID to get correct abi encoding for the remaining arguments (i.e everything except the requestID)
  const calldata = "0x" + encodedData.slice(66); // we just pop the dummy requestID to get the correct value to pass for `decryptedCts`

  const numSigners = 1; // for the moment mocked mode only uses 1 signer
  const decryptResultsEIP712signatures = await computeDecryptSignatures(
    jsonRpcApiProvider,
    handles,
    calldata,
    numSigners,
  );
  await jsonRpcApiProvider.send("hardhat_impersonateAccount", [EthersT.ZeroAddress]);
  const impersonatedSigner = new EthersT.JsonRpcSigner(jsonRpcApiProvider, EthersT.ZeroAddress);

  console.log("=============================================");
  console.log(`Gateway server: CALL fulfillRequest REQUEST ID = ${requestID}`);
  console.log("=============================================");

  try {
    const tx = await gateway
      .connect(impersonatedSigner)
      //@ts-ignore
      .fulfillRequest(requestID, calldata, decryptResultsEIP712signatures);
    await tx.wait();
  } catch (error) {
    console.error(error);
  }

  await jsonRpcApiProvider.send("hardhat_stopImpersonatingAccount", [EthersT.ZeroAddress]);

  const blockNumber = await jsonRpcApiProvider.send("eth_blockNumber", []);
  console.log(
    `Gateway sent decryption result in callback tx succesfully for requestID ${requestID} on block no ${blockNumber}`,
  );
};

async function computeDecryptSignatures(
  provider: EthersT.Provider,
  handlesList: bigint[],
  decryptedResult: string,
  numSigners: number,
): Promise<string[]> {
  const signatures: string[] = [];

  for (let idx = 0; idx < numSigners; idx++) {
    const privKeySigner = PRIVATE_KEY_KMS_SIGNER;
    if (privKeySigner) {
      const kmsSigner = new EthersT.Wallet(privKeySigner).connect(provider);
      const signature = await kmsSign(provider, handlesList, decryptedResult, kmsSigner);
      signatures.push(signature);
    } else {
      throw new Error(`Private key for signer ${idx} not found in environment variables`);
    }
  }
  return signatures;
}

async function kmsSign(
  provider: EthersT.Provider,
  handlesList: bigint[],
  decryptedResult: string,
  kmsSigner: EthersT.Wallet,
) {
  const kmsAdd = KMSVERIFIER_ADDRESS;
  const chainId = (await provider.getNetwork()).chainId;
  assert(chainId !== undefined);

  const domain = {
    name: "KMSVerifier",
    version: "1",
    chainId: chainId,
    verifyingContract: kmsAdd,
  };

  const types = {
    DecryptionResult: [
      {
        name: "aclAddress",
        type: "address",
      },
      {
        name: "handlesList",
        type: "uint256[]",
      },
      {
        name: "decryptedResult",
        type: "bytes",
      },
    ],
  };
  const message = {
    aclAddress: aclAdd,
    handlesList: handlesList,
    decryptedResult: decryptedResult,
  };

  const signature = await kmsSigner.signTypedData(domain, types, message);
  const sigRSV = EthersT.Signature.from(signature);
  const v = 27 + sigRSV.yParity;
  const r = sigRSV.r;
  const s = sigRSV.s;

  const result = r + s.substring(2) + v.toString(16);
  return result;
}
