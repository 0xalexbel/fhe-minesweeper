import { expect } from "chai";
import { ParamType, ethers } from "ethers";
import { FhevmInstance } from "fhevmjs/node";
import hre from "hardhat";

import { FHEMinesweeperMock } from "../../types";
import { awaitAllDecryptionResults, initGateway } from "../asyncDecrypt";
import { createInstance } from "../instance";
import { Signers, getSigners, initSigners } from "../signers";
import { debug } from "../utils";
import { deployFHEMinesweeperFixture } from "./FHEMinesweeper.fixture";

const ROWS = 11;
const COLS = 11;
const BITS_PER_CELL = 2;
const BITS_PER_ROW = BigInt(BITS_PER_CELL * COLS);
const CELL_IS_BOMB_THRESHOLD = 0x9;

describe("FHEMinesweeper", function () {
  let minesweeperAddress: string;
  let minesweeper: FHEMinesweeperMock;
  let fhevm: FhevmInstance;
  let signers: Signers;

  before(async function () {
    await initSigners();
    signers = await getSigners();
    await initGateway();
  });

  beforeEach(async function () {
    const contract = await deployFHEMinesweeperFixture();
    minesweeperAddress = await contract.getAddress();
    minesweeper = contract;
    fhevm = await createInstance();
  });

  function solidityKeccak256(types: ReadonlyArray<string | ParamType>, values: ReadonlyArray<any>) {
    return BigInt(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(types, values)));
  }

  function computeDeterministicBoard(level: bigint, count: bigint) {
    /*
        // Random 0
        uint256 clearBoard = uint256(keccak256(abi.encode(_count, level, uint256(0))));
        // Random 1
        uint256 clearR = uint256(keccak256(abi.encode(_count, level, uint256(1))));
        if (level == 1) {
            // Random 2
            clearR = clearR | uint256(keccak256(abi.encode(_count, level, uint256(2))));
        }
        if (level == 2) {
            // Random 3
            clearR = clearR | uint256(keccak256(abi.encode(_count, level, uint256(3))));
        }
        clearBoard = clearBoard & clearR;
        clearBoard = clearBoard & 0x5555555555555555555555555555555555555555555555555555555555555555;
        _count += 1;
        euint256 board = TFHE.asEuint256(clearBoard);
        TFHE.allowThis(board);
        return Game({ level: level, board: board, moves: 0, exploded: __zeroU8(), movesCount: 0 });

    */
    // Random 0
    let clearBoard = solidityKeccak256(["uint256", "uint8", "uint256"], [count, level, 0n]);
    // Random 1
    let clearR = solidityKeccak256(["uint256", "uint8", "uint256"], [count, level, 1n]);
    if (level == 1n) {
      // Random 2
      clearR = clearR | solidityKeccak256(["uint256", "uint8", "uint256"], [count, level, 2n]);
    }
    if (level == 2n) {
      // Random 3
      clearR = clearR | solidityKeccak256(["uint256", "uint8", "uint256"], [count, level, 3n]);
    }
    clearBoard = clearBoard & clearR;
    clearBoard =
      clearBoard & (ethers.toBigInt("0x5555555555555555555555555555555555555555555555555555555555555555") >> 14n);
    return clearBoard;
  }

  function printBoard(board: bigint) {
    let s: string = "";
    for (let i = 0; i < ROWS; ++i) {
      if (i < 10) {
        s = `(${i})  `;
      } else {
        s = `(${i}) `;
      }
      for (let j = 0; j < COLS; ++j) {
        const pos = (i * COLS + j) * 2;
        const a = 1n << BigInt(pos);
        const isBomb = (board & a) > 0n;
        s += `${isBomb ? 1 : 0} `;
      }
      console.log(s);
    }
  }

  function printArrayBoard(board: number[], onlyBombs: boolean, noDecrement: boolean) {
    let s: string = "";
    for (let i = 0; i < ROWS; ++i) {
      if (i < 10) {
        s = `(${i})  `;
      } else {
        s = `(${i}) `;
      }
      for (let j = 0; j < COLS; ++j) {
        const pos = i * COLS + j;
        let v = Math.min(board[pos], 10);
        if (!noDecrement) {
          expect(v).to.be.greaterThan(0);
          v--;
        }
        if (onlyBombs) {
          v = v >= 9 ? 1 : 0;
        }
        s += `${v} `;
      }
      console.log(s);
    }
  }

  async function printClearCache(onlyBombs: boolean, noDecrement: boolean) {
    const res = await minesweeper.connect(signers.alice).getClearCacheRows256();
    console.log(`res[0] = ${res[0]}`);
    console.log(`res[1] = ${res[1]}`);
    const a = parseCache4x256([res[0], res[1]], ROWS * COLS);
    printArrayBoard(a, onlyBombs, noDecrement);
  }

  function computeBombSolution(board: bigint) {
    const sol: number[] = [];
    for (let i = 0; i < ROWS; ++i) {
      for (let j = 0; j < COLS; ++j) {
        const pos = (i * COLS + j) * 2;
        const a = 1n << BigInt(pos);
        const isBomb = (board & a) > 0n;
        sol.push(isBomb ? 1 : 0);
      }
    }
    return sol;
  }

  function parseCacheRow4x256(cacheRow4x256: bigint, len: number) {
    const res: number[] = [];
    const n_cols = Math.min(256 / 4, len);
    for (let i = 0; i < n_cols; ++i) {
      res.push(ethers.toNumber((cacheRow4x256 >> BigInt(i * 4)) & BigInt(0xf)));
    }
    return res;
  }

  function parseCache4x256(cache4x256: bigint[], len: number) {
    expect(cache4x256.length).to.equal(2);

    let res: number[] = [];
    let remaining = len;
    for (let i = 0; i < cache4x256.length; ++i) {
      const n = Math.min(256 / 4, remaining);
      if (n == 0) {
        break;
      }
      res = res.concat(parseCacheRow4x256(cache4x256[i], n));
      remaining -= n;
    }

    return res;
  }

  async function decryptCacheRows256() {
    const { cacheRow0, cacheRow1 } = await minesweeper.connect(signers.alice).getEncryptedCacheRows256();
    const decryptedcacheRow0 = await debug.decrypt256(cacheRow0);
    const decryptedcacheRow1 = await debug.decrypt256(cacheRow1);
    return parseCache4x256([decryptedcacheRow0, decryptedcacheRow1], ROWS * COLS);
  }

  function boxIndices(row: number, col: number) {
    return {
      c: row * COLS + col,
      l: col == 0 ? -1 : row * COLS + col - 1,
      r: col == 10 ? -1 : row * COLS + col + 1,
      t: row == 0 ? -1 : (row - 1) * COLS + col,
      b: row == 10 ? -1 : (row + 1) * COLS + col,
      tl: col == 0 || row == 0 ? -1 : (row - 1) * COLS + col - 1,
      tr: col == 10 || row == 0 ? -1 : (row - 1) * COLS + col + 1,
      bl: col == 0 || row == 10 ? -1 : (row + 1) * COLS + col - 1,
      br: col == 10 || row == 10 ? -1 : (row + 1) * COLS + col + 1,
    };
  }

  function computeClueSolution(board: bigint, bombMask: number) {
    const solBomb = computeBombSolution(board);
    const sol: number[] = [];
    for (let i = 0; i < ROWS; ++i) {
      for (let j = 0; j < COLS; ++j) {
        const box = boxIndices(i, j);
        let s = box.t >= 0 ? solBomb[box.t] : 0;
        s += box.b >= 0 ? solBomb[box.b] : 0;
        s += box.l >= 0 ? solBomb[box.l] : 0;
        s += box.r >= 0 ? solBomb[box.r] : 0;
        s += box.tl >= 0 ? solBomb[box.tl] : 0;
        s += box.tr >= 0 ? solBomb[box.tr] : 0;
        s += box.bl >= 0 ? solBomb[box.bl] : 0;
        s += box.br >= 0 ? solBomb[box.br] : 0;
        s += solBomb[box.c];

        if (solBomb[box.c] > 0) {
          s = s | bombMask;
        }

        sol.push(s);
      }
    }
    return sol;
  }

  it("Level 0 Generated board should be valid", async function () {
    for (let i = 0; i < 3; ++i) {
      const tx = await minesweeper.connect(signers.alice).newGame(0);
      await tx.wait();
      const clearBoard = computeDeterministicBoard(BigInt(0), BigInt(i));

      const board = await minesweeper.connect(signers.alice).boardOf(signers.alice);
      const decryptedBoard = await debug.decrypt256(board);

      const deterministic = await minesweeper.deterministic();
      expect(deterministic).to.be.true;

      expect(clearBoard).to.equal(decryptedBoard);
    }
  });

  it("Level 1 Generated board should be valid", async function () {
    for (let i = 0; i < 3; ++i) {
      const tx = await minesweeper.connect(signers.alice).newGame(1);
      await tx.wait();
      const clearBoard = computeDeterministicBoard(BigInt(1), BigInt(i));

      const board = await minesweeper.connect(signers.alice).boardOf(signers.alice);
      const decryptedBoard = await debug.decrypt256(board);

      const deterministic = await minesweeper.deterministic();
      expect(deterministic).to.be.true;

      expect(clearBoard).to.equal(decryptedBoard);
    }
  });

  it("Level 2 Generated board should be valid", async function () {
    for (let i = 0; i < 3; ++i) {
      const tx = await minesweeper.connect(signers.alice).newGame(2);
      await tx.wait();
      const clearBoard = computeDeterministicBoard(BigInt(2), BigInt(i));

      const board = await minesweeper.connect(signers.alice).boardOf(signers.alice);
      const decryptedBoard = await debug.decrypt256(board);

      const deterministic = await minesweeper.deterministic();
      expect(deterministic).to.be.true;

      expect(clearBoard).to.equal(decryptedBoard);
    }
  });

  it("Generated board should be valid", async function () {
    for (let i = 0; i < 3; ++i) {
      const tx = await minesweeper.connect(signers.alice).newGame(i);
      await tx.wait();
      const clearBoard = computeDeterministicBoard(BigInt(i), BigInt(i));

      const board = await minesweeper.connect(signers.alice).boardOf(signers.alice);
      const decryptedBoard = await debug.decrypt256(board);

      expect(clearBoard).to.equal(decryptedBoard);
    }
  });

  it("Test Level 0", async function () {
    const tx0 = await minesweeper.connect(signers.alice).newGame(0n);
    await tx0.wait();

    const clearBoard = computeDeterministicBoard(BigInt(0), BigInt(0));
    printBoard(clearBoard);

    const allRows: bigint[] = [];

    const row0 = (clearBoard >> (0n * BITS_PER_ROW)) & BigInt("0x3FFFFF");
    allRows.push(row0);
    const row1 = (clearBoard >> (1n * BITS_PER_ROW)) & BigInt("0x3FFFFF");
    allRows.push(row1);
    const row2 = (clearBoard >> (2n * BITS_PER_ROW)) & BigInt("0x3FFFFF");
    allRows.push(row2);
    const row3 = (clearBoard >> (3n * BITS_PER_ROW)) & BigInt("0x3FFFFF");
    allRows.push(row3);
    const row4 = (clearBoard >> (4n * BITS_PER_ROW)) & BigInt("0x3FFFFF");
    allRows.push(row4);
    const row5 = (clearBoard >> (5n * BITS_PER_ROW)) & BigInt("0x3FFFFF");
    allRows.push(row5);
    const row6 = (clearBoard >> (6n * BITS_PER_ROW)) & BigInt("0x3FFFFF");
    allRows.push(row6);
    const row7 = (clearBoard >> (7n * BITS_PER_ROW)) & BigInt("0x3FFFFF");
    allRows.push(row7);
    const row8 = (clearBoard >> (8n * BITS_PER_ROW)) & BigInt("0x3FFFFF");
    allRows.push(row8);
    const row9 = (clearBoard >> (9n * BITS_PER_ROW)) & BigInt("0x3FFFFF");
    allRows.push(row9);
    const row10 = (clearBoard >> (10n * BITS_PER_ROW)) & BigInt("0x3FFFFF");
    allRows.push(row10);
    const rem = clearBoard >> (11n * BITS_PER_ROW);

    expect(BigInt("0x3FFFFF") >> 21n).to.equal(1n);
    expect(BigInt("0x3FFFFF") >> 22n).to.equal(0n);
    expect(BigInt("0x3FFFFF") >> 20n).to.equal(3n);
    expect((BigInt("0x3FFFFF") << 22n) | BigInt("0x3FFFFF")).to.equal(BigInt("0xFFFFFFFFFFF"));

    //rem 14bits
    const a = clearBoard & BigInt("0xFFFFFFFFFFF");
    const b = clearBoard & BigInt("0xFFFFFFFFFFFFFFFFFFFFFF");
    const c = clearBoard & BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF");
    const d = clearBoard & BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF");
    const f = clearBoard & BigInt("0x3FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF");
    expect((row1 << 22n) | row0).to.equal(a);
    expect((row3 << (3n * BITS_PER_ROW)) | (row2 << (2n * BITS_PER_ROW)) | (row1 << 22n) | row0).to.equal(b);
    expect(
      (row7 << (7n * BITS_PER_ROW)) |
        (row6 << (6n * BITS_PER_ROW)) |
        (row5 << (5n * BITS_PER_ROW)) |
        (row4 << (4n * BITS_PER_ROW)) |
        (row3 << (3n * BITS_PER_ROW)) |
        (row2 << (2n * BITS_PER_ROW)) |
        (row1 << 22n) |
        row0,
    ).to.equal(c);
    expect(
      (row9 << (9n * BITS_PER_ROW)) |
        (row8 << (8n * BITS_PER_ROW)) |
        (row7 << (7n * BITS_PER_ROW)) |
        (row6 << (6n * BITS_PER_ROW)) |
        (row5 << (5n * BITS_PER_ROW)) |
        (row4 << (4n * BITS_PER_ROW)) |
        (row3 << (3n * BITS_PER_ROW)) |
        (row2 << (2n * BITS_PER_ROW)) |
        (row1 << 22n) |
        row0,
    ).to.equal(d);
    expect(
      (row10 << (10n * BITS_PER_ROW)) |
        (row9 << (9n * BITS_PER_ROW)) |
        (row8 << (8n * BITS_PER_ROW)) |
        (row7 << (7n * BITS_PER_ROW)) |
        (row6 << (6n * BITS_PER_ROW)) |
        (row5 << (5n * BITS_PER_ROW)) |
        (row4 << (4n * BITS_PER_ROW)) |
        (row3 << (3n * BITS_PER_ROW)) |
        (row2 << (2n * BITS_PER_ROW)) |
        (row1 << 22n) |
        row0,
    ).to.equal(f);
    expect(
      (rem << 242n) |
        (row10 << (10n * BITS_PER_ROW)) |
        (row9 << (9n * BITS_PER_ROW)) |
        (row8 << (8n * BITS_PER_ROW)) |
        (row7 << (7n * BITS_PER_ROW)) |
        (row6 << (6n * BITS_PER_ROW)) |
        (row5 << (5n * BITS_PER_ROW)) |
        (row4 << (4n * BITS_PER_ROW)) |
        (row3 << (3n * BITS_PER_ROW)) |
        (row2 << (2n * BITS_PER_ROW)) |
        (row1 << 22n) |
        row0,
    ).to.equal(clearBoard);

    const n =
      (rem << 256n) |
      (row10 << (10n * BITS_PER_ROW)) |
      (row9 << (9n * BITS_PER_ROW)) |
      (row8 << (8n * BITS_PER_ROW)) |
      (row7 << (7n * BITS_PER_ROW)) |
      (row6 << (6n * BITS_PER_ROW)) |
      (row5 << (5n * BITS_PER_ROW)) |
      (row4 << (4n * BITS_PER_ROW)) |
      (row3 << (3n * BITS_PER_ROW)) |
      (row2 << (2n * BITS_PER_ROW)) |
      (row1 << (1n * BITS_PER_ROW)) |
      (row0 << (0n * BITS_PER_ROW));

    const { rows, cols } = await minesweeper.size();
    expect(rows).to.equal(ROWS);
    expect(cols).to.equal(COLS);

    for (let i = 0; i < rows; ++i) {
      const tx = await minesweeper.connect(signers.alice).computeRow(i);
      await tx.wait();

      const r = await minesweeper.uint32_0();
      const decryptedRow = await debug.decrypt32(r);
      expect(decryptedRow & BigInt("0x3FFFFF")).to.equal(allRows[i]);
    }

    for (let i = 0; i < rows; ++i) {
      for (let j = 0; j < cols; ++j) {
        const tx = await minesweeper.connect(signers.alice).computeCell(i, j);
        await tx.wait();

        const cell = await minesweeper.uint4_0();
        const decryptedCell = (await debug.decrypt4(cell)) & BigInt("0x3");
        expect(decryptedCell).to.lessThanOrEqual(1);
      }
    }

    const boardCluesSolution = [
      1, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 2, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 2, 2, 2,
      1, 1, 1, 1, 2, 1, 1, 2, 3, 3, 3, 1, 1, 1, 2, 3, 2, 2, 3, 3, 4, 4, 2, 1, 2, 4, 5, 3, 2, 3, 3, 4, 4, 2, 1, 1, 3, 3,
      2, 1, 1, 1, 2, 4, 3, 2, 1, 3, 4, 3, 0, 0, 1, 2, 4, 3, 2, 0, 1, 2, 2, 0, 0, 0, 1, 2, 3, 2, 1, 1, 2, 2, 0, 0, 0, 1,
      1, 2, 1, 1, 0, 0, 0,
    ];

    const boardBombsSolution = [
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1,
      0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 1, 0, 0, 0, 0,
    ];

    expect(boardBombsSolution).to.deep.equal(computeBombSolution(clearBoard));
    expect(boardCluesSolution).to.deep.equal(computeClueSolution(clearBoard, 0));
  });

  async function testLevel(level: bigint, count: bigint) {
    const tx0 = await minesweeper.connect(signers.alice).newGame(level);
    await tx0.wait();

    const clearBoard = computeDeterministicBoard(level, count);
    const { rows, cols } = await minesweeper.size();
    expect(rows).to.equal(ROWS);
    expect(cols).to.equal(COLS);

    const boardCluesSolution = computeClueSolution(clearBoard, CELL_IS_BOMB_THRESHOLD);
    const boardBombsSolution = computeBombSolution(clearBoard);

    for (let i = 0; i < rows; ++i) {
      for (let j = 0; j < cols; ++j) {
        let tx = await minesweeper.connect(signers.alice).computeSixBitsAt(i, j);
        await tx.wait();

        const cellIndex = i * Number(cols) + j;

        tx = await minesweeper.connect(signers.alice).bombAndClueAt(cellIndex);
        await tx.wait();

        const bomb = await minesweeper.uint8_0();
        const clue = await minesweeper.uint4_0();

        const decryptedBomb = await debug.decrypt8(bomb);
        const decryptedClue = await debug.decrypt4(clue);

        const computedBomb = decryptedClue >= BigInt(CELL_IS_BOMB_THRESHOLD) ? 1n : 0n;

        expect(computedBomb).to.equal(decryptedBomb);
        expect(decryptedBomb).to.equal(boardBombsSolution[cellIndex]);
        expect(decryptedClue).to.equal(boardCluesSolution[cellIndex]);
      }
    }

    const decryptedCache = await decryptCacheRows256();
    expect(decryptedCache).to.deep.equal(boardCluesSolution);
  }

  // Was tested manually
  // it("New game + decrypt + new game should revert", async function () {
  //   const tx0 = await minesweeper.connect(signers.alice).newGame(0);
  //   await tx0.wait();

  //   const tx = await minesweeper.connect(signers.alice).revealCell(1);
  //   await tx.wait();

  //   const tx1 = await minesweeper.connect(signers.alice).newGame(1);
  //   await tx1.wait();

  //   await awaitAllDecryptionResults();
  // });

  it("Test Level 0", async function () {
    await testLevel(0n, 0n);
  });

  it("Test Level 0x2", async function () {
    await testLevel(0n, 0n);
    await testLevel(0n, 1n);
  });

  it("Test Level 1", async function () {
    await testLevel(1n, 0n);
  });

  it("Test Level 2", async function () {
    await testLevel(2n, 0n);
  });

  it("Test Level 0 Density", async function () {
    const tx0 = await minesweeper.connect(signers.alice).newGame(0n);
    await tx0.wait();

    const clearBoard = computeDeterministicBoard(BigInt(1), BigInt(0));
    const { rows, cols } = await minesweeper.size();
    expect(rows).to.equal(11);
    expect(cols).to.equal(11);

    const boardBombsSolution = computeBombSolution(clearBoard);

    let count = 0;
    for (let i = 0; i < boardBombsSolution.length; ++i) {
      count += boardBombsSolution[i];
    }

    printBoard(clearBoard);
    console.log(`Dentity = ${100 * (count / (11 * 11))}`);
  });

  it("Test Level 1 Density", async function () {
    const tx0 = await minesweeper.connect(signers.alice).newGame(1n);
    await tx0.wait();

    const clearBoard = computeDeterministicBoard(BigInt(1), BigInt(0));
    const { rows, cols } = await minesweeper.size();
    expect(rows).to.equal(11);
    expect(cols).to.equal(11);

    const boardBombsSolution = computeBombSolution(clearBoard);

    let count = 0;
    for (let i = 0; i < boardBombsSolution.length; ++i) {
      count += boardBombsSolution[i];
    }

    printBoard(clearBoard);
    console.log(`Dentity = ${100 * (count / (11 * 11))}`);
  });

  it("Test Level 2 Density", async function () {
    const tx0 = await minesweeper.connect(signers.alice).newGame(2n);
    await tx0.wait();

    const clearBoard = computeDeterministicBoard(BigInt(2), BigInt(0));
    const { rows, cols } = await minesweeper.size();
    expect(rows).to.equal(11);
    expect(cols).to.equal(11);

    const boardBombsSolution = computeBombSolution(clearBoard);

    let count = 0;
    for (let i = 0; i < boardBombsSolution.length; ++i) {
      count += boardBombsSolution[i];
    }

    printBoard(clearBoard);
    console.log(`Dentity = ${100 * (count / (11 * 11))}`);
  });

  async function testLevelWithReveal(level: bigint, count: bigint) {
    const tx0 = await minesweeper.connect(signers.alice).newGame(level);
    await tx0.wait();

    const clearBoard = computeDeterministicBoard(level, count);
    const { rows, cols } = await minesweeper.size();
    expect(rows).to.equal(ROWS);
    expect(cols).to.equal(COLS);

    const boardCluesSolution = computeClueSolution(clearBoard, CELL_IS_BOMB_THRESHOLD);

    for (let i = 0; i < rows; ++i) {
      for (let j = 0; j < cols; ++j) {
        const cellIndex = i * Number(cols) + j;

        let tx = await minesweeper.connect(signers.alice).bombAndClueAt(cellIndex);
        await tx.wait();

        const bomb = await minesweeper.uint8_0();
        const clue = await minesweeper.uint4_0();

        const decryptedBomb = await debug.decrypt8(bomb);
        const decryptedClue = await debug.decrypt4(clue);

        if (decryptedBomb == 0n) {
          expect(decryptedClue).to.be.lessThan(CELL_IS_BOMB_THRESHOLD);
        } else {
          expect(decryptedClue).to.be.greaterThanOrEqual(CELL_IS_BOMB_THRESHOLD);
        }

        tx = await minesweeper.connect(signers.alice).revealCellMock(cellIndex);
        await tx.wait();

        await awaitAllDecryptionResults();

        const clearCellPlusOne = await minesweeper.connect(signers.alice).getClearCachedValue4PlusOne(cellIndex);
        if (decryptedBomb > 0n) {
          expect(clearCellPlusOne - 1n).to.be.greaterThanOrEqual(CELL_IS_BOMB_THRESHOLD);
        } else {
          expect(clearCellPlusOne - 1n).to.equal(boardCluesSolution[cellIndex]);
        }

        const callbackCellPlusOne = await minesweeper
          .connect(signers.alice)
          .getDebugClearCluesPlusOne(signers.alice, cellIndex);
        expect(callbackCellPlusOne).to.equal(clearCellPlusOne);
      }
    }

    await printClearCache(true, false);
  }

  async function winLevelWithReveal(level: bigint, count: bigint) {
    const tx0 = await minesweeper.connect(signers.alice).newGame(level);
    await tx0.wait();

    const clearBoard = computeDeterministicBoard(level, count);
    const { rows, cols } = await minesweeper.size();
    expect(rows).to.equal(ROWS);
    expect(cols).to.equal(COLS);

    const boardCluesSolution = computeClueSolution(clearBoard, CELL_IS_BOMB_THRESHOLD);
    const boardBombsSolution = computeBombSolution(clearBoard);

    for (let i = 0; i < rows; ++i) {
      for (let j = 0; j < cols; ++j) {
        const cellIndex = i * Number(cols) + j;

        if (boardBombsSolution[cellIndex] > 0) {
          continue;
        }

        const tx = await minesweeper.connect(signers.alice).revealCell(cellIndex);
        await tx.wait();

        await awaitAllDecryptionResults();

        const clearCell = await minesweeper.connect(signers.alice).getClearCell(cellIndex);

        const callbackCellPlusOne = await minesweeper
          .connect(signers.alice)
          .getDebugClearCluesPlusOne(signers.alice, cellIndex);
        expect(callbackCellPlusOne).to.equal(clearCell + 1n);

        expect(clearCell).to.equal(boardCluesSolution[cellIndex]);
      }
    }

    const victory = await minesweeper.connect(signers.alice).isItAVictory();
    expect(victory).to.be.true;
    const gameover = await minesweeper.connect(signers.alice).isItGameOver();
    expect(gameover).to.be.false;
  }

  it("Test Level 0 with reveal", async function () {
    await testLevelWithReveal(0n, 0n);
  });

  it("Test Level 2 with reveal", async function () {
    await testLevelWithReveal(2n, 0n);
  });

  it("Win Level 2 with reveal", async function () {
    await winLevelWithReveal(2n, 0n);
  });

  it("Test clear value cache", async function () {
    for (let i = 0; i < ROWS * COLS; ++i) {
      const v = await minesweeper.connect(signers.alice).getClearCachedValue4PlusOne(i);
      expect(v).to.equal(0);

      const tx = await minesweeper.connect(signers.alice).setClearCachedValue4PlusOne(i, CELL_IS_BOMB_THRESHOLD);
      await tx.wait();

      const v2 = await minesweeper.connect(signers.alice).getClearCachedValue4PlusOne(i);
      expect(v2).to.equal(CELL_IS_BOMB_THRESHOLD + 1);
    }
  });

  it("Test Bug", async function () {
    const tx0 = await minesweeper.connect(signers.alice).newGame(0);
    await tx0.wait();

    const tx1 = await minesweeper.connect(signers.alice).revealCell(30);
    await tx1.wait();

    await awaitAllDecryptionResults();

    const clearValue: bigint = await minesweeper.connect(signers.alice).getClearCell(30);
    console.log("clearValue[30] = " + clearValue);

    expect(clearValue).to.equal(0);

    const isGameOver = await minesweeper.isItGameOver();
    expect(isGameOver).to.be.false;

    await printClearCache(false, true);
  });
});
