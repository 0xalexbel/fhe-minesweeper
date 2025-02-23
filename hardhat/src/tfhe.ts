import { type address, checkBool, checkU4, checkU8, checkU256, type uint4, type uint8, type uint256 } from "./sol";

export type bitsfhe = 1 | 4 | 8 | 16 | 32 | 64 | 128 | 256 | 160;

export type typefhe = {
  value: bigint;
  bits: bitsfhe;
  initialized: boolean;
};

export type ebool = typefhe & { bits: 1 };
export type euint4 = typefhe & { bits: 4 };
export type euint8 = typefhe & { bits: 8 };
export type euint16 = typefhe & { bits: 16 };
export type euint32 = typefhe & { bits: 32 };
export type euint64 = typefhe & { bits: 64 };
export type euint128 = typefhe & { bits: 128 };
export type euint256 = typefhe & { bits: 256 };

export class TFHEError extends Error {}

export class TFHE {
  static decryptU4(value: euint4): uint4 {
    return checkU4(value.value);
  }
  static decryptU8(value: euint8): uint8 {
    return checkU8(value.value);
  }
  static decryptBool(value: ebool): boolean {
    return checkBool(value.value) === 1n ? true : false;
  }
  static decryptU256(value: euint256): uint256 {
    return checkU256(value.value);
  }
  static toBigInt(value: typefhe | number | bigint | string): bigint {
    if (typeof value === "bigint") {
      return value;
    }
    if (typeof value === "number") {
      return BigInt(value);
    }
    if (typeof value === "string") {
      return BigInt(value);
    }
    return value.value;
  }
  static uninitialized256(): euint256 {
    return { value: 0n, bits: 256, initialized: false };
  }
  static uninitializedBool(): ebool {
    return { value: 0n, bits: 1, initialized: false };
  }
  static uninitialized8(): euint8 {
    return { value: 0n, bits: 8, initialized: false };
  }
  static uninitialized4(): euint4 {
    return { value: 0n, bits: 4, initialized: false };
  }
  static isInitialized(v: typefhe) {
    return v.initialized;
  }
  static is(v: typefhe, bits: bitsfhe) {
    if (!v) {
      throw new TFHEError("Null or Undefined TFHE value");
    }
    if (v.bits !== bits) {
      throw new TFHEError(`Invalid TFHE value, got ${v.bits} bits, expecting ${bits}.`);
    }
  }

  static get ZERO_4(): euint4 {
    return { value: 0n, bits: 4, initialized: true };
  }
  static get ZERO_8(): euint8 {
    return { value: 0n, bits: 8, initialized: true };
  }
  static get ZERO_16(): euint16 {
    return { value: 0n, bits: 16, initialized: true };
  }
  static get ZERO_32(): euint32 {
    return { value: 0n, bits: 32, initialized: true };
  }
  static get ZERO_256(): euint256 {
    return { value: 0n, bits: 256, initialized: true };
  }

  static asEuint256(v: typefhe | uint256): euint256 {
    const _v = checkU256(typeof v === "bigint" ? v : v.value);
    return {
      value: _v & BigInt(0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn),
      bits: 256,
      initialized: true,
    };
  }
  static asEuint128(v: typefhe): euint128 {
    return { value: v.value & BigInt(0xffffffffffffffffffffffffffffffffn), bits: 128, initialized: true };
  }
  static asEuint64(v: typefhe): euint64 {
    return { value: v.value & BigInt(0xffffffffffffffffn), bits: 64, initialized: true };
  }
  static asEuint32(v: typefhe): euint32 {
    return { value: v.value & BigInt(0xffffffff), bits: 32, initialized: true };
  }
  static asEuint16(v: typefhe): euint16 {
    return { value: v.value & BigInt(0xffff), bits: 16, initialized: true };
  }
  static asEuint8(v: typefhe): euint8 {
    return { value: v.value & BigInt(0xff), bits: 8, initialized: true };
  }
  static asEuint4(v: typefhe): euint4 {
    return { value: v.value & BigInt(0xf), bits: 4, initialized: true };
  }

  static shl4(l: euint4, r: euint4 | uint4): euint4 {
    const _r = checkU8(typeof r === "bigint" ? r : r.value);
    return { value: checkU4(l.value << _r), bits: 4, initialized: true };
  }

  static shl256(l: euint256, r: euint8 | uint8): euint256 {
    const _r = checkU8(typeof r === "bigint" ? r : r.value);
    return { value: checkU256(l.value << _r), bits: 256, initialized: true };
  }

  static shr4(l: euint4, r: euint4 | uint4): euint4 {
    const _r = checkU8(typeof r === "bigint" ? r : r.value);
    return { value: checkU4(l.value >> _r), bits: 4, initialized: true };
  }

  static shr8(l: euint8, r: euint8 | uint8): euint8 {
    const _r = checkU8(typeof r === "bigint" ? r : r.value);
    return { value: checkU8(l.value >> _r), bits: 8, initialized: true };
  }

  static shr256(l: euint256, r: euint8 | uint8): euint256 {
    const _r = checkU8(typeof r === "bigint" ? r : r.value);
    return { value: checkU256(l.value >> _r), bits: 256, initialized: true };
  }

  static or4(l: euint4, r: euint4): euint4 {
    return { value: checkU4(l.value | r.value), bits: 4, initialized: true };
  }

  static or256(l: euint256, r: euint256): euint256 {
    return { value: checkU256(l.value | r.value), bits: 256, initialized: true };
  }

  static xor256(l: euint256, r: euint256 | uint256): euint256 {
    const _r = checkU256(typeof r === "bigint" ? r : r.value);
    return { value: checkU256(l.value ^ _r), bits: 256, initialized: true };
  }

  static eq256(l: euint256, r: euint256 | uint256): ebool {
    const _r = checkU256(typeof r === "bigint" ? r : r.value);
    return { value: checkBool(l.value === _r ? 1n : 0n), bits: 1, initialized: true };
  }

  static and4(l: euint4, r: euint4 | uint4): euint4 {
    const _r = checkU4(typeof r === "bigint" ? r : r.value);
    return { value: checkU4(l.value & _r), bits: 4, initialized: true };
  }

  static and8(l: euint8, r: euint8 | uint8): euint8 {
    const _r = checkU8(typeof r === "bigint" ? r : r.value);
    return { value: checkU8(l.value & _r), bits: 8, initialized: true };
  }

  static and256(l: euint256, r: euint256): euint256 {
    return { value: checkU256(l.value & r.value), bits: 256, initialized: true };
  }

  static add8(l: euint8, r: euint8 | uint8): euint8 {
    const _r = checkU8(typeof r === "bigint" ? r : r.value);
    return { value: checkU8(l.value + _r), bits: 8, initialized: true };
  }

  static add4(l: euint4, r: euint4): euint4 {
    return { value: checkU4(l.value + r.value), bits: 4, initialized: true };
  }

  /* eslint-disable @typescript-eslint/no-unused-vars */
  static allowThis(v: typefhe) {}
  static allow(v: typefhe, account: address) {}
}
