import type { BlockTag, Provider } from "ethers";

import * as sol from "./sol";
import type { EthersModule, uint4, uint8, uint256 } from "./sol";
import { TFHE, euint256 } from "./tfhe";

export const BOARD_MASK = 0x5555555555555555555555555555555555555555555555555555555555555555n >> 14n;
export const MINESWEEPER_ROWS: uint8 = 11n;
export const MINESWEEPER_COLS: uint8 = 11n;
export const BITS_PER_CELL: uint8 = 2n;
export const BITS_PER_ROW = BigInt(BITS_PER_CELL * MINESWEEPER_COLS);
export const CELL_IS_BOMB_THRESHOLD: uint8 = 0x9n;
export const CUSTOM_LEVEL: uint8 = 0xffn;
export const GATEWAY_INTERVAL_MS: number = 1000;
export const BLOCK_INTERVAL_S: number = 10;

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function printBoard(board: uint256 | euint256 | bigint, rows?: number, cols?: number) {
  const _board = TFHE.toBigInt(board);
  const COLS = cols ?? Number(MINESWEEPER_COLS);
  const ROWS = rows ?? Number(MINESWEEPER_ROWS);

  let s: string = "";
  for (let i = 0; i < ROWS; ++i) {
    if (i < 10) {
      s = `(${i})  `;
    } else {
      s = `(${i}) `;
    }
    for (let j = 0; j < COLS; ++j) {
      const pos = (BigInt(i) * BigInt(COLS) + BigInt(j)) * 2n;
      const a = 1n << BigInt(pos);
      const isBomb = (_board & a) > 0n;
      s += `${isBomb ? 1 : 0} `;
    }
    console.log(s);
  }
}

export function printBoardArray(board: uint8[] | number[], rows?: number, cols?: number) {
  const COLS = cols ?? Number(MINESWEEPER_COLS);
  const ROWS = rows ?? Number(MINESWEEPER_ROWS);

  let s: string = "";
  for (let i = 0; i < ROWS; ++i) {
    if (i < 10) {
      s = `(${i})  `;
    } else {
      s = `(${i}) `;
    }
    for (let j = 0; j < COLS; ++j) {
      const pos = i * COLS + j;
      const v = Math.min(Number(board[pos]), 10);
      if (v >= 10) {
        s += `${v} `;
      } else {
        s += ` ${v} `;
      }
    }
    console.log(s);
  }
}

export function printBoardColorArray(
  board: uint8[] | number[],
  rows?: number,
  cols?: number,
  pendingCellDecryption?: number,
) {
  const COLS = cols ?? Number(MINESWEEPER_COLS);
  const ROWS = rows ?? Number(MINESWEEPER_ROWS);

  const yellow = "\x1b[1m\x1b[33m";
  const red = "\x1b[1m\x1b[31m";
  const reset = "\x1b[0m\x1b[0m";

  let s: string = "";
  for (let i = 0; i < ROWS; ++i) {
    if (i < 10) {
      s = `(${i})  `;
    } else {
      s = `(${i}) `;
    }
    for (let j = 0; j < COLS; ++j) {
      const pos = i * COLS + j;
      const v = Math.min(Number(board[pos]), 10);
      if (v == 0) {
        if (pos === pendingCellDecryption) {
          s += `${red} ? ${reset}`;
        } else {
          s += ` X `;
        }
      } else if (v >= 11) {
        s += `${red}${v - 1} ${reset}`;
      } else if (v == 10) {
        s += `${red} ${v - 1} ${reset}`;
      } else {
        s += `${yellow} ${v - 1} ${reset}`;
      }
    }
    console.log(s);
  }
}

function boxIndices(row: number, col: number) {
  const COLS = Number(MINESWEEPER_COLS);
  const ROWS = Number(MINESWEEPER_ROWS);
  const COL_MAX = COLS - 1;
  const ROW_MAX = ROWS - 1;
  return {
    c: row * COLS + col,
    l: col == 0 ? -1 : row * COLS + col - 1,
    r: col == COL_MAX ? -1 : row * COLS + col + 1,
    t: row == 0 ? -1 : (row - 1) * COLS + col,
    b: row == ROW_MAX ? -1 : (row + 1) * COLS + col,
    tl: col == 0 || row == 0 ? -1 : (row - 1) * COLS + col - 1,
    tr: col == COL_MAX || row == 0 ? -1 : (row - 1) * COLS + col + 1,
    bl: col == 0 || row == ROW_MAX ? -1 : (row + 1) * COLS + col - 1,
    br: col == COL_MAX || row == ROW_MAX ? -1 : (row + 1) * COLS + col + 1,
  };
}

export function computeBombSolution(board: uint256 | euint256 | bigint): uint4[] {
  const _board = TFHE.toBigInt(board);
  const COLS = Number(MINESWEEPER_COLS);
  const ROWS = Number(MINESWEEPER_ROWS);

  const sol: uint4[] = [];
  for (let i = 0; i < ROWS; ++i) {
    for (let j = 0; j < COLS; ++j) {
      const pos = (i * COLS + j) * 2;
      const a = 1n << BigInt(pos);
      const isBomb = (_board & a) > 0n;
      sol.push(isBomb ? 1n : 0n);
    }
  }
  return sol;
}

export function computeClueSolution(board: uint256 | euint256 | bigint, bombMask: uint4): uint4[] {
  sol.checkU4(bombMask);
  const COLS = Number(MINESWEEPER_COLS);
  const ROWS = Number(MINESWEEPER_ROWS);

  const solBomb: uint4[] = computeBombSolution(board);
  const solution: uint4[] = [];
  for (let i = 0; i < ROWS; ++i) {
    for (let j = 0; j < COLS; ++j) {
      const box = boxIndices(i, j);
      let s: uint4 = box.t >= 0 ? solBomb[box.t] : 0n;
      s += box.b >= 0 ? solBomb[box.b] : 0n;
      s += box.l >= 0 ? solBomb[box.l] : 0n;
      s += box.r >= 0 ? solBomb[box.r] : 0n;
      s += box.tl >= 0 ? solBomb[box.tl] : 0n;
      s += box.tr >= 0 ? solBomb[box.tr] : 0n;
      s += box.bl >= 0 ? solBomb[box.bl] : 0n;
      s += box.br >= 0 ? solBomb[box.br] : 0n;
      s += solBomb[box.c];

      if (solBomb[box.c] > 0) {
        s = s | bombMask;
      }

      solution.push(sol.checkU4(s));
    }
  }
  return solution;
}

function parseCacheBlock256x4(cacheBlock: uint256, len: number): uint4[] {
  sol.checkU256(cacheBlock);
  const res: uint4[] = [];
  const n_cols = Math.min(256 / 4, len);
  for (let i = 0; i < n_cols; ++i) {
    res.push((cacheBlock >> BigInt(i * 4)) & BigInt(0xf));
  }
  return res;
}

export function parseCache256x4(cacheBlocks: uint256[], len: number): uint4[] {
  sol.solrequire(cacheBlocks.length === 2);
  sol.checkU256(cacheBlocks[0]);
  sol.checkU256(cacheBlocks[1]);

  let res: uint4[] = [];
  let remaining = len;
  for (let i = 0; i < cacheBlocks.length; ++i) {
    const n = Math.min(256 / 4, remaining);
    if (n == 0) {
      break;
    }
    res = res.concat(parseCacheBlock256x4(cacheBlocks[i], n));
    remaining -= n;
  }

  return res;
}

export function printCache256x4(cache: { block0: uint256; block1: uint256 }, len: number) {
  const a = parseCache256x4([cache.block0, cache.block1], len);
  printBoardArray(a);
}

export function printCache256x4WithColor(
  cache: { block0: uint256; block1: uint256 },
  len: number,
  pendingCellDecryption?: number,
) {
  const a = parseCache256x4([cache.block0, cache.block1], len);
  printBoardColorArray(a, undefined, undefined, pendingCellDecryption);
}

export function parseMoves(moves: bigint, len: number) {
  const arr: number[] = [];
  for (let i = 0; i < len; ++i) {
    const a = 1n << (BigInt(i) * 2n);
    const isOne = (moves & a) > 0n;
    arr.push(isOne ? 1 : 0);
  }
  return arr;
}

export function cellMask(cellIndex: bigint) {
  return sol.MAX_U256 ^ (BigInt(0x3) << (cellIndex * 2n));
}

export function computeDeterministicBoard(ethers: EthersModule, level: bigint, count: bigint, cellIndex: bigint) {
  return computeDeterministicBoardWithMask(ethers, level, count, cellMask(cellIndex));
}

export function computeDeterministicBoardWithMask(
  ethers: EthersModule,
  level: bigint,
  count: bigint,
  startMask: bigint,
) {
  /*
        // Level 0: R0 & R1 & R3 & (R2 | R4)
        // Level 1: R0 & R1 & R3
        // Level 2: R0 & R1 & (R2 | R4)
        uint256 clearBoard = uint256(keccak256(abi.encode(_deterministicGameCount, level, uint256(0)))) &
            uint256(keccak256(abi.encode(_deterministicGameCount, level, uint256(1))));

        if (level < 2) {
            clearBoard = clearBoard & uint256(keccak256(abi.encode(_deterministicGameCount, level, uint256(3))));
        }

        if (level != 1) {
            clearBoard =
                clearBoard &
                (uint256(keccak256(abi.encode(_deterministicGameCount, level, uint256(2)))) |
                    uint256(keccak256(abi.encode(_deterministicGameCount, level, uint256(4)))));
        }

        clearBoard = clearBoard & (BOARD_MASK & startMask);
        board = TFHE.asEuint256(clearBoard);
    */

  const R0 = sol.solidityKeccak256(ethers, ["uint256", "uint8", "uint256"], [count, level, 0n]);
  const R1 = sol.solidityKeccak256(ethers, ["uint256", "uint8", "uint256"], [count, level, 1n]);
  const R2 = sol.solidityKeccak256(ethers, ["uint256", "uint8", "uint256"], [count, level, 2n]);
  const R3 = sol.solidityKeccak256(ethers, ["uint256", "uint8", "uint256"], [count, level, 3n]);
  const R4 = sol.solidityKeccak256(ethers, ["uint256", "uint8", "uint256"], [count, level, 4n]);

  let clearBoard = R0 & R1;
  if (level < 2n) {
    clearBoard = clearBoard & R3;
  }
  if (level !== 1n) {
    clearBoard = clearBoard & (R2 | R4);
  }

  clearBoard = clearBoard & BOARD_MASK & startMask;
  return clearBoard;
}

export function computeDensity(board: bigint): number {
  const boardBombsSolution = computeBombSolution(board);

  let count = 0;
  for (let i = 0; i < boardBombsSolution.length; ++i) {
    count += Number(boardBombsSolution[i]);
  }

  return (100.0 * count) / Number(MINESWEEPER_COLS * MINESWEEPER_ROWS);
}

export function setBombAt(board: bigint, cellIndex: bigint) {
  if (cellIndex >= MINESWEEPER_ROWS * MINESWEEPER_COLS) {
    throw new Error("Cell index out of bounds");
  }
  return (1n << (cellIndex * 2n)) | board;
}

export async function getPastCellRevealedEvents(
  ethers: EthersModule,
  readOnlyProvider: Provider,
  address: string,
  player: string,
  cellIndex: number,
  fromBlock?: BlockTag,
  toBlock?: BlockTag,
): Promise<
  | Array<{
      player: string;
      cellIndex: number;
      cellValue: number;
      victory: boolean;
    }>
  | undefined
> {
  const abi = ["event CellRevealed(address player, uint8 cellIndex, uint8 cellValue, bool victory)"];
  const iface = new ethers.Interface(abi);
  const filter = {
    address,
    fromBlock,
    toBlock,
  };
  const arr: Array<{
    player: string;
    cellIndex: number;
    cellValue: number;
    victory: boolean;
  }> = [];
  const logs = await readOnlyProvider.getLogs(filter);
  for (let i = 0; i < logs.length; ++i) {
    const l = iface.parseLog(logs[i]);
    if (l === null) {
      continue;
    }
    if (l.args[0] !== player) {
      continue;
    }
    if (Number(l.args[1]) !== cellIndex) {
      continue;
    }
    arr.push({
      player,
      cellIndex: cellIndex,
      cellValue: Number(l.args[2]),
      victory: Boolean(l.args[3]),
    });
  }
  return arr;
}

export function defaultBoard(): bigint {
  /*
    (0)  0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    (1)  0, 0, 1, 1, 0, 0, 0, 0, 0, 1, 0,
    (2)  0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0,
    (3)  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    (4)  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    (5)  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    (6)  0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0,
    (7)  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    (8)  0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0,
    (9)  0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0,
    (10) 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    */

  const bombs = [
    0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0,
  ];
  const len = Number(MINESWEEPER_ROWS * MINESWEEPER_COLS);

  let board = 0n;
  for (let i = 0; i < len; ++i) {
    if (bombs[i] == 1) {
      board = setBombAt(board, BigInt(i));
    }
  }

  return board;
}
