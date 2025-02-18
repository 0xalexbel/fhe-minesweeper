import assert from "assert";
import { expect } from "chai";

const ROWS = 11n;
const COLS = 11n;
const BITS_PER_CELL = 2n;
const CELL_MASK = 0x3n;
const CELL_IS_BOMB_THRESHOLD = 0x9n;

function uint256(v: bigint) {
  assert(v >= 0 && v <= BigInt(0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn));
  return v;
}
function uint8(v: bigint) {
  assert(v >= 0 && v <= BigInt(0xff));
  return v;
}
function uint4(v: bigint) {
  assert(v >= 0 && v <= BigInt(0xf));
  return v;
}
function asUint32(v: bigint) {
  return v & BigInt(0xffffffff);
}
function asUint8(v: bigint) {
  return v & BigInt(0xff);
}
function asUint4(v: bigint) {
  return v & BigInt(0xf);
}

export class FHEMinesweeperSimulator {
  // function _bitToRowCol(uint8 bitIndex) internal pure returns (uint8 row, uint8 col) {
  //     require(bitIndex < ROWS * COLS * BITS_PER_CELL, "Bit index owerflow");
  //     row = (bitIndex / COLS) * BITS_PER_CELL;
  //     col = (bitIndex % (COLS * BITS_PER_CELL)) / BITS_PER_CELL;
  // }

  // function _rowColToBit(uint8 row, uint8 col) internal pure returns (uint8 bitIndex) {
  //     require(row < ROWS && col < COLS, "Row/Col owerflow");
  //     bitIndex = (row * COLS + col) * BITS_PER_CELL;
  // }

  _cellToRowCol(cellIndex: bigint): { row: bigint; col: bigint } {
    uint8(cellIndex);
    assert(cellIndex < ROWS * COLS, "Cell index owerflow");
    const row = cellIndex / COLS;
    const col = cellIndex % COLS;

    return {
      row: uint8(row),
      col: uint8(col),
    };
  }

  _rowColToBit(row: bigint, col: bigint): bigint {
    uint8(row);
    uint8(col);

    assert(row < ROWS && col < COLS, "Row/Col owerflow");

    return uint8((row * COLS + col) * BITS_PER_CELL);
  }

  _bitToRowCol(bitIndex: bigint): { row: bigint; col: bigint } {
    uint8(bitIndex);

    assert(bitIndex < ROWS * COLS * BITS_PER_CELL, "Bit index owerflow");

    const row = (bitIndex / COLS) * BITS_PER_CELL;
    const col = (bitIndex % (COLS * BITS_PER_CELL)) / BITS_PER_CELL;

    return {
      row: uint8(row),
      col: uint8(col),
    };
  }

  _rowColToCell(row: bigint, col: bigint): bigint {
    uint8(row);
    uint8(col);

    assert(row < ROWS && col < COLS, "Row/Col owerflow");

    const cellIndex = uint8(row * COLS + col);
    return cellIndex;
  }

  _computeRow(board: bigint, r: bigint): bigint {
    uint256(board);
    uint8(r);
    assert(r >= 0 && r < ROWS, "Invalid row");
    const bitIndex = this._rowColToBit(r, 0n);

    //TFHE.asEuint32(TFHE.shr(board, bitIndex));
    return asUint32(board >> bitIndex);
  }

  _getSixBitsAt(board: bigint, row: bigint, col: bigint): bigint {
    uint256(board);
    uint8(row);
    uint8(col);

    let sixBits: bigint;
    if (col == 0n) {
      // And is optional
      //sixBits = TFHE.and(TFHE.asEuint8(TFHE.shr(board, _rowColToBit(row, 0))), uint8(0xF));
      sixBits = asUint8(board >> this._rowColToBit(row, 0n)) & BigInt(0xf);
    } else {
      //sixBits = TFHE.asEuint8(TFHE.shr(board, _rowColToBit(row, col - 1)));
      sixBits = asUint8(board >> this._rowColToBit(row, col - 1n));
    }

    return uint8(sixBits);
  }

  _bombAndClueAt(board: bigint, cellIndex: bigint): { isBomb: bigint; clue: bigint } {
    uint256(board);
    uint8(cellIndex);

    const { row, col } = this._cellToRowCol(cellIndex);

    const rowSixBits = this._getSixBitsAt(board, row, col);

    let clue: bigint = 0n;
    let isBomb: bigint = 0n;

    let sum = 0n;
    let prevRowSixBits = sum;
    let nextRowSixBits = sum;

    if (row > 0) {
      // Can be cached
      prevRowSixBits = this._getSixBitsAt(board, row - 1n, col);
    }

    if (row < ROWS - 1n) {
      // Can be cached
      nextRowSixBits = this._getSixBitsAt(board, row + 1n, col);
    }

    sum = nextRowSixBits + rowSixBits + prevRowSixBits;

    // Optimization can get rid of this line
    // Optimization cast to uint4
    //euint4 right = TFHE.and(TFHE.asEuint4(TFHE.shr(sum, uint8(0))), CELL_MASK);
    let right = uint4(asUint4(sum) & CELL_MASK);
    let middle = uint4(asUint4(sum >> uint8(2n)) & CELL_MASK);
    let left = uint4(asUint4(sum >> uint8(4n)) & CELL_MASK);

    if (col == 0n) {
      // No need to compute left
      left = middle;
      middle = right;
      right = 0n;
    } else if (col == COLS - 1n) {
      // No need to compute right
      left = 0n;
    }

    // 0 < N <= 9
    clue = left + right + middle;

    if (col == 0n) {
      // 00 or 01
      isBomb = uint8(rowSixBits & CELL_MASK);
    } else {
      isBomb = uint8((rowSixBits >> BITS_PER_CELL) & CELL_MASK);
    }

    const rowSixBits4 = asUint4(rowSixBits);

    // Bomb bit = 0, keep bit 0 & 1
    // Bomb bit = 2 (remove bit 0 and 1)
    const bombMask = uint4(col == 0n ? rowSixBits4 & 0x3n : rowSixBits4 >> 2n);

    //set bits 0
    clue = clue | bombMask;
    //set bits 3
    clue = clue | (bombMask << 3n);

    return {
      isBomb: uint8(isBomb),
      clue: uint4(clue),
    };
  }

  printArrayBoard(board: bigint[], onlyBombs: boolean) {
    let s: string = "";
    for (let i = 0; i < ROWS; ++i) {
      if (i < 10) {
        s = `(${i})  `;
      } else {
        s = `(${i}) `;
      }
      for (let j = 0; j < COLS; ++j) {
        const pos = i * Number(ROWS) + j;
        let v = board[pos] < 9n ? board[pos] : 9n;
        if (onlyBombs) {
          v = v >= 9n ? 1n : 0n;
        }
        s += `${v} `;
      }
      console.log(s);
    }
  }
}
