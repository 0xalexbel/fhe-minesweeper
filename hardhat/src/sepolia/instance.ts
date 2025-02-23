import { FhevmInstance, createInstance as createFhevmInstance } from "fhevmjs/node";
import fs from "fs";
import { HardhatRuntimeEnvironment, HttpNetworkConfig } from "hardhat/types";
import path from "path";

import { ACL_ADDRESS, GATEWAY_URL, KMSVERIFIER_ADDRESS } from "../constants";

export function keysDir() {
  return path.join(path.dirname(path.dirname(path.normalize(__dirname))), "keys");
}

// Path to save the file
const publicParamsJSONFilePath = path.join(keysDir(), "publicparams.json");
const publicParamsBinFilePath = path.join(keysDir(), "publicparams.bin");
const publicKeyJSONFilePath = path.join(keysDir(), "publickey.json");
const publicKeyBinFilePath = path.join(keysDir(), "publickey.bin");

// export function packageDirectorySync({cwd: string} = {}) {
// 	const filePath = findUpSync('package.json', {cwd});
// 	return filePath && path.dirname(filePath);
// }

// export function findUpSync(name: string, {
// 	cwd = process.cwd(),
// 	type = 'file',
// 	stopAt,
// } = {}) {
// 	let directory = path.resolve(toPath(cwd) ?? '');
// 	const {root} = path.parse(directory);
// 	stopAt = path.resolve(directory, toPath(stopAt) ?? root);

// 	while (directory && directory !== stopAt && directory !== root) {
// 		const filePath = path.isAbsolute(name) ? name : path.join(directory, name);

// 		try {
// 			const stats = fs.statSync(filePath, {throwIfNoEntry: false});
// 			if ((type === 'file' && stats?.isFile()) || (type === 'directory' && stats?.isDirectory())) {
// 				return filePath;
// 			}
// 		} catch {}

// 		directory = path.dirname(directory);
// 	}
// }

export async function createKeysDir() {
  const p = keysDir();
  if (fs.existsSync(p)) {
    return;
  }
  fs.mkdirSync(p);
}

function storePublicParams(acl: string, value: { publicParamsId: string; publicParams: Uint8Array }) {
  createKeysDir();

  const json = JSON.stringify({ acl: acl, publicParamsId: value.publicParamsId }, null, 2);

  fs.writeFileSync(publicParamsBinFilePath, Buffer.from(value.publicParams));
  fs.writeFileSync(publicParamsJSONFilePath, json, "utf-8");

  console.log(`Stored public params for: ${acl} path=${publicParamsBinFilePath}`);
}

function storePublicKey(acl: string, value: { publicKeyId: string; publicKey: Uint8Array }) {
  createKeysDir();

  const json = JSON.stringify({ acl: acl, publicKeyId: value.publicKeyId }, null, 2);

  fs.writeFileSync(publicKeyBinFilePath, Buffer.from(value.publicKey));
  fs.writeFileSync(publicKeyJSONFilePath, json, "utf-8");

  console.log(`Stored public key for: ${acl} path=${publicKeyBinFilePath}`);
}

/* eslint-disable @typescript-eslint/no-unused-vars */
function getPublicParams(acl: string): { publicParamsId: string; publicParams: Uint8Array } | null {
  try {
    const data = fs.readFileSync(publicParamsBinFilePath);
    const json = JSON.parse(fs.readFileSync(publicParamsJSONFilePath, "utf8"));
    return { publicParamsId: json.publicParamsId, publicParams: new Uint8Array(data) };
  } catch {
    return null;
  }
}

/* eslint-disable @typescript-eslint/no-unused-vars */
function getPublicKey(acl: string): { publicKeyId: string; publicKey: Uint8Array } | null {
  try {
    const data = fs.readFileSync(publicKeyBinFilePath);
    const json = JSON.parse(fs.readFileSync(publicKeyJSONFilePath, "utf8"));
    return { publicKeyId: json.publicKeyId, publicKey: new Uint8Array(data) };
  } catch {
    return null;
  }
}

export async function createInstance(hre: HardhatRuntimeEnvironment): Promise<FhevmInstance> {
  const httpNetworkConfig: HttpNetworkConfig = hre.network.config as HttpNetworkConfig;

  const _pk = getPublicKey(ACL_ADDRESS);
  const _pp = getPublicParams(ACL_ADDRESS);

  const publicParams = _pp
    ? {
        "2048": _pp,
      }
    : null;

  const fhevm = await createFhevmInstance({
    kmsContractAddress: KMSVERIFIER_ADDRESS,
    aclContractAddress: ACL_ADDRESS,
    networkUrl: httpNetworkConfig.url,
    gatewayUrl: GATEWAY_URL,
    publicKey: _pk?.publicKey,
    publicKeyId: _pk?.publicKeyId,
    publicParams,
  });

  if (!_pp) {
    const pp = fhevm.getPublicParams(2048);
    if (pp) {
      storePublicParams(ACL_ADDRESS, pp);
    }
  }

  if (!_pk) {
    const pk = fhevm.getPublicKey();
    if (pk) {
      storePublicKey(ACL_ADDRESS, pk);
    }
  }

  return fhevm;
}
