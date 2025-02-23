import type { ParamType } from "ethers";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type EthersModule = any;

export type SolType =
  | "bool"
  | "uint4"
  | "uint8"
  | "uint16"
  | "uint32"
  | "uint64"
  | "uint128"
  | "uint160"
  | "uint256"
  | "address";

export const TYPE_BOOL: SolType = "bool";
export const TYPE_UINT4: SolType = "uint4";
export const TYPE_UINT8: SolType = "uint8";
export const TYPE_UINT16: SolType = "uint16";
export const TYPE_UINT32: SolType = "uint32";
export const TYPE_UINT64: SolType = "uint64";
export const TYPE_UINT128: SolType = "uint128";
export const TYPE_UINT160: SolType = "uint160";
export const TYPE_UINT256: SolType = "uint256";
export const TYPE_ADDRESS: SolType = "address";

export type bool = bigint;
export type uint4 = bigint;
export type uint8 = bigint;
export type uint16 = bigint;
export type uint32 = bigint;
export type uint64 = bigint;
export type uint128 = bigint;
export type uint160 = bigint;
export type uint256 = bigint;
export type address = bigint;

export const MAX_U256: uint256 = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn;
export const MAX_U160: uint160 = 0xffffffffffffffffffffffffffffffffffffffffn;
export const MAX_U128: uint128 = 0xffffffffffffffffffffffffffffffffn;
export const MAX_U64: uint64 = 0xffffffffffffffffn;
export const MAX_U32: uint32 = 0xffffffffn;
export const MAX_U16: uint16 = 0xffffn;
export const MAX_U8: uint8 = 0xffn;
export const MAX_U4: uint4 = 0xfn;

export class SolError extends Error {}

export function solrequire(cond: boolean, message?: string) {
  if (!cond) {
    throw new SolError(message);
  }
}

export function revert(message?: string) {
  throw new SolError("Revert: " + (message ?? "Unknown reason"));
}

export function toAddr(ethers: EthersModule, value: number | bigint | string): address {
  const a = ethers.getAddress(ethers.toBeHex(value, 20));
  return checkAddr(ethers.toBigInt(a));
}

// Type cast
export function uint4(value: bigint): uint4 {
  return value & BigInt(0xf);
}

export function uint8(value: bigint): uint8 {
  return value & BigInt(0xff);
}

export function uint256(value: bigint): uint256 {
  return value & MAX_U256;
}

// Type check
export function checkAddr(value: address) {
  solrequire(value >= 0 && value <= MAX_U160);
  return value;
}

export function checkU4(value: uint4): uint4 {
  solrequire(value >= 0 && value <= MAX_U4, `uint4 overflow value=${value}`);
  return value;
}

export function checkU8(value: uint8): uint8 {
  solrequire(value >= 0 && value <= MAX_U8, `uint8 overflow value=${value}`);
  return value;
}

export function checkU16(value: uint16): uint16 {
  solrequire(value >= 0 && value <= MAX_U16, `uint16 overflow value=${value}`);
  return value;
}

export function checkU32(value: uint32): uint32 {
  solrequire(value >= 0 && value <= MAX_U32, `uint32 overflow value=${value}`);
  return value;
}

export function checkU64(value: uint64): uint64 {
  solrequire(value >= 0 && value <= MAX_U64, `uint64 overflow value=${value}`);
  return value;
}

export function checkU128(value: uint128): uint128 {
  solrequire(value >= 0 && value <= MAX_U128, `uint128 overflow value=${value}`);
  return value;
}

export function checkU256(value: uint256): uint256 {
  solrequire(value >= 0 && value <= MAX_U256, `uint256 overflow value=${value}`);
  return value;
}

export function checkBool(value: bool): bool {
  solrequire(value >= 0 && value <= 1n);
  return value;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function solidityKeccak256(
  ethers: EthersModule,
  types: ReadonlyArray<string | ParamType>,
  values: ReadonlyArray<any>,
): uint256 {
  return BigInt(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(types, values)));
}

export class mapping1<T> {
  map: Map<string, T>;
  defaultT: () => T;

  constructor(defaultT: () => T) {
    this.map = new Map<string, T>();
    this.defaultT = defaultT;
  }

  get(key: bigint): T {
    const a = this.map.get(key.toString());
    if (a === undefined) {
      return this.defaultT();
    }
    return a;
  }

  set(key: bigint, value: T): void {
    this.map.set(key.toString(), value);
  }

  delete(key: bigint, throwIfNotExist?: boolean) {
    const a = this.map.get(key.toString());
    if (a === undefined && throwIfNotExist === true) {
      throw new SolError("Try to delete a unexisting key");
    }
    this.map.set(key.toString(), this.defaultT());
  }
}

export class mapping2<T> {
  map: Map<string, mapping1<T>>;
  defaultT: () => T;

  constructor(defaultT: () => T) {
    this.map = new Map<string, mapping1<T>>();
    this.defaultT = defaultT;
  }

  get(key1: bigint, key2: bigint): T {
    const a = this.map.get(key1.toString());
    if (a === undefined) {
      return this.defaultT();
    }
    return a.get(key2);
  }

  set(key1: bigint, key2: bigint, value: T): void {
    const k = key1.toString();
    let a = this.map.get(k);
    if (a === undefined) {
      this.map.set(k, new mapping1(this.defaultT));
      a = this.map.get(k);
      if (!a) {
        throw new SolError();
      }
    }
    a.set(key2, value);
  }

  delete(key1: bigint, key2: bigint) {
    const a = this.map.get(key1.toString());
    if (a === undefined) {
      return;
    }
    a.delete(key2);
  }
}
