/*eslint-disable @typescript-eslint/ban-ts-comment */
import { ethers as EthersT } from "ethers";
import gatewayArtifact from "fhevm-core-contracts/artifacts/gateway/GatewayContract.sol/GatewayContract.json";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { waitNBlocks } from "../../test/utils";
import { ACL_ADDRESS, GATEWAYCONTRACT_ADDRESS, KMSVERIFIER_ADDRESS, PRIVATE_KEY_KMS_SIGNER } from "../constants";
import { awaitCoprocessor, getClearText } from "./coprocessorUtils";
import { impersonateAddress } from "./mockedSetup";

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
  return now.toLocaleTimeString("en-US", {
    hour12: true,
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
};

const argEvents =
  "(uint256 indexed requestID, uint256[] cts, address contractCaller, bytes4 callbackSelector, uint256 msgValue, uint256 maxTimestamp, bool passSignaturesToCaller)";

const argEvents2 = "(uint256 indexed requestID, bool success, bytes result)";

let gateway: EthersT.Contract;
let firstBlockListening: number;
let lastBlockSnapshotForDecrypt: number;
let backgroundDecryptor: NodeJS.Timeout | undefined = undefined;

function ifaceEventDecryption(hre: HardhatRuntimeEnvironment) {
  return new hre.ethers.Interface(["event EventDecryption" + argEvents])!;
}

function ifaceResultCallback(hre: HardhatRuntimeEnvironment) {
  return new hre.ethers.Interface(["event ResultCallback" + argEvents2])!;
}

function isSolidityCoverageRunning(hre: HardhatRuntimeEnvironment): boolean {
  return (
    (
      hre as HardhatRuntimeEnvironment & {
        __SOLIDITY_COVERAGE_RUNNING: boolean;
      }
    ).__SOLIDITY_COVERAGE_RUNNING === true
  );
}

function isMock(hre: HardhatRuntimeEnvironment) {
  return hre.network.name === "hardhat" || hre.network.name === "localhost";
}

function isMockWithoutSolidityCoverage(hre: HardhatRuntimeEnvironment): boolean {
  return isMock(hre) && !isSolidityCoverageRunning(hre);
}

/* eslint-disable @typescript-eslint/no-unused-vars */
export const closeGateway = async (hre: HardhatRuntimeEnvironment): Promise<void> => {
  if (backgroundDecryptor !== undefined) {
    clearInterval(backgroundDecryptor);
    backgroundDecryptor = undefined;
  }
};

export const initGateway = async (hre: HardhatRuntimeEnvironment, autoDecryptIntervalMS?: number): Promise<void> => {
  /*
   hardhat or localhost without gateway server!
  */
  if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
    return;
  }

  if (autoDecryptIntervalMS !== undefined && backgroundDecryptor === undefined) {
    //console.log(`Start auto decrypt timer: interval=${autoDecryptIntervalMS}`);
    backgroundDecryptor = setInterval(async () => {
      //console.log(`Gatway: auto decrypt...`);
      await awaitAllDecryptionResults(hre);
    }, autoDecryptIntervalMS);
  }

  firstBlockListening = await hre.ethers.provider.getBlockNumber();
  if (isMockWithoutSolidityCoverage(hre)) {
    // evm_snapshot is not supported in coverage mode
    await hre.ethers.provider.send("set_lastBlockSnapshotForDecrypt", [firstBlockListening]);
  }
  // this function will emit logs for every request and fulfilment of a decryption
  gateway = await hre.ethers.getContractAt(gatewayArtifact.abi, GATEWAYCONTRACT_ADDRESS);
  gateway.on(
    "EventDecryption",
    async (requestID, cts, contractCaller, callbackSelector, msgValue, maxTimestamp, eventData) => {
      const blockNumber = eventData.log.blockNumber;
      console.log(`${currentTime()} - Requested decrypt on block ${blockNumber} (requestID ${requestID})`);
    },
  );
  gateway.on("ResultCallback", async (requestID, success, result, eventData) => {
    const blockNumber = eventData.log.blockNumber;
    console.log(`${currentTime()} - Fulfilled decrypt on block ${blockNumber} (requestID ${requestID})`);
  });
};

export const awaitAllDecryptionResults = async (hre: HardhatRuntimeEnvironment): Promise<void> => {
  gateway = await hre.ethers.getContractAt(gatewayArtifact.abi, GATEWAYCONTRACT_ADDRESS);
  const provider = hre.ethers.provider;

  if (isMockWithoutSolidityCoverage(hre)) {
    // evm_snapshot is not supported in coverage mode
    lastBlockSnapshotForDecrypt = await provider.send("get_lastBlockSnapshotForDecrypt");
    if (lastBlockSnapshotForDecrypt < firstBlockListening) {
      firstBlockListening = lastBlockSnapshotForDecrypt + 1;
    }
  }

  await fulfillAllPastRequestsIds(hre, isMock(hre));

  firstBlockListening = (await hre.ethers.provider.getBlockNumber()) + 1;

  if (isMockWithoutSolidityCoverage(hre)) {
    // evm_snapshot is not supported in coverage mode
    await provider.send("set_lastBlockSnapshotForDecrypt", [firstBlockListening]);
  }
};

const getAlreadyFulfilledDecryptions = async (hre: HardhatRuntimeEnvironment): Promise<[bigint]> => {
  const results: EthersT.Log[] = [];
  const eventDecryptionResult = await gateway.filters.ResultCallback().getTopicFilter();
  const filterDecryptionResult = {
    address: GATEWAYCONTRACT_ADDRESS,
    fromBlock: firstBlockListening,
    toBlock: "latest",
    topics: eventDecryptionResult,
  };
  const pastResults = await hre.ethers.provider.getLogs(filterDecryptionResult);
  const computedResults = results.concat(
    pastResults.map((result) => ifaceResultCallback(hre).parseLog(result)!.args[0]),
  );
  //@ts-ignore
  return computedResults;
};

const allTrue = (arr: boolean[], fn = Boolean) => arr.every(fn);

const fulfillAllPastRequestsIds = async (hre: HardhatRuntimeEnvironment, mocked: boolean) => {
  const eventDecryption = await gateway.filters.EventDecryption().getTopicFilter();
  const results = await getAlreadyFulfilledDecryptions(hre);
  const filterDecryption = {
    address: GATEWAYCONTRACT_ADDRESS,
    fromBlock: firstBlockListening,
    toBlock: "latest",
    topics: eventDecryption,
  };
  const pastRequests = await hre.ethers.provider.getLogs(filterDecryption);
  for (const request of pastRequests) {
    const event = ifaceEventDecryption(hre).parseLog(request)!;
    const requestID = event.args[0];
    const handles: bigint[] = event.args[1];
    const typesList = handles.map((handle) => parseInt(handle.toString(16).slice(-4, -2), 16));
    const msgValue = event.args[4];

    if (!results.includes(requestID)) {
      // if request is not already fulfilled
      if (mocked) {
        // in mocked mode, we trigger the decryption fulfillment manually
        await awaitCoprocessor(hre.ethers.provider);

        // first check tat all handles are allowed for decryption
        const aclArtifact = await import("fhevm-core-contracts/artifacts/contracts/ACL.sol/ACL.json");
        const acl = await hre.ethers.getContractAt(aclArtifact.abi, ACL_ADDRESS);
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

        const abiCoder = new hre.ethers.AbiCoder();

        const encodedData = abiCoder.encode(["uint256", ...types], [31, ...valuesFormatted4]); // 31 is just a dummy uint256 requestID to get correct abi encoding for the remaining arguments (i.e everything except the requestID)
        const calldata = "0x" + encodedData.slice(66); // we just pop the dummy requestID to get the correct value to pass for `decryptedCts`

        const numSigners = 1; // for the moment mocked mode only uses 1 signer
        const decryptResultsEIP712signatures = await computeDecryptSignatures(hre, handles, calldata, numSigners);
        const relayer = await impersonateAddress(hre, hre.ethers.ZeroAddress, hre.ethers.parseEther("100"));

        await gateway
          .connect(relayer)
          //@ts-ignore
          .fulfillRequest(requestID, calldata, decryptResultsEIP712signatures, {
            value: msgValue,
          });
      } else {
        // in non-mocked mode we must wait until the gateway service relayer submits the decryption fulfillment tx
        await waitNBlocks(hre, 1);
        await fulfillAllPastRequestsIds(hre, mocked);
      }
    }
  }
};

async function computeDecryptSignatures(
  hre: HardhatRuntimeEnvironment,
  handlesList: bigint[],
  decryptedResult: string,
  numSigners: number,
): Promise<string[]> {
  const signatures: string[] = [];

  for (let idx = 0; idx < numSigners; idx++) {
    const privKeySigner = PRIVATE_KEY_KMS_SIGNER;
    if (privKeySigner) {
      const kmsSigner = new hre.ethers.Wallet(privKeySigner).connect(hre.ethers.provider);
      const signature = await kmsSign(hre, handlesList, decryptedResult, kmsSigner);
      signatures.push(signature);
    } else {
      throw new Error(`Private key for signer ${idx} not found in environment variables`);
    }
  }
  return signatures;
}

async function kmsSign(
  hre: HardhatRuntimeEnvironment,
  handlesList: bigint[],
  decryptedResult: string,
  kmsSigner: EthersT.Wallet,
) {
  const kmsAdd = KMSVERIFIER_ADDRESS;
  const chainId = (await hre.ethers.provider.getNetwork()).chainId;

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
  const sigRSV = hre.ethers.Signature.from(signature);
  const v = 27 + sigRSV.yParity;
  const r = sigRSV.r;
  const s = sigRSV.s;

  const result = r + s.substring(2) + v.toString(16);
  return result;
}
