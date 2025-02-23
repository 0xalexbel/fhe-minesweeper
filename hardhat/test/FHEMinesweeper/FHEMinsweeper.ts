import { expect } from "chai";
import hre from "hardhat";

import {
  CELL_IS_BOMB_THRESHOLD,
  MINESWEEPER_COLS,
  MINESWEEPER_ROWS,
  cellMask,
  computeBombSolution,
  computeClueSolution,
  computeDensity,
  computeDeterministicBoard,
  computeDeterministicBoardWithMask,
  parseCache256x4,
} from "../../src/fheminesweeper";
import { awaitAllDecryptionResults, initGateway } from "../../src/hardhat/asyncDecrypt";
import { uint256 } from "../../src/sol";
import { FHEMinesweeper, FHEMinesweeperMock } from "../../types";
import { Signers, getSigners, initSigners } from "../signers";
import { debug } from "../utils";
import { deployFHEMinesweeperMockFixture } from "./FHEMinesweeper.fixture";

describe("FHEMinesweeper", function () {
  let minesweeper: FHEMinesweeperMock;
  let signers: Signers;

  before(async function () {
    await initSigners();
    signers = await getSigners();
    await initGateway(hre);
  });

  beforeEach(async function () {
    const contract = await deployFHEMinesweeperMockFixture();
    minesweeper = contract;
  });

  it("Level 0 Generated board should be valid", async function () {
    for (let i = 0; i < 3; ++i) {
      const firstCellIndex = i == 2 ? 1n : i == 1 ? 19n : 16n;
      const startMask = cellMask(firstCellIndex);

      const tx = await minesweeper.connect(signers.alice).newGame(0, firstCellIndex);
      await tx.wait();
      const clearBoard = computeDeterministicBoardWithMask(hre.ethers, BigInt(0), BigInt(i), startMask);

      const board = await minesweeper.connect(signers.alice).boardOf(signers.alice);
      const decryptedBoard = await debug.decrypt256(hre, board);

      const deterministic = await minesweeper.deterministic();
      expect(deterministic).to.equal(true);

      expect(clearBoard).to.equal(decryptedBoard);
    }
  });

  it("Level 1 Generated board should be valid", async function () {
    for (let i = 0; i < 3; ++i) {
      const firstCellIndex = i == 2 ? 3n : i == 1 ? 1n : 11n;
      const startMask = cellMask(firstCellIndex);

      const tx = await minesweeper.connect(signers.alice).newGame(1, firstCellIndex);
      await tx.wait();
      const clearBoard = computeDeterministicBoardWithMask(hre.ethers, BigInt(1), BigInt(i), startMask);

      const board = await minesweeper.connect(signers.alice).boardOf(signers.alice);
      const decryptedBoard = await debug.decrypt256(hre, board);

      const deterministic = await minesweeper.deterministic();
      expect(deterministic).to.equal(true);

      expect(clearBoard).to.equal(decryptedBoard);
    }
  });

  it("Level 2 Generated board should be valid", async function () {
    for (let i = 0; i < 3; ++i) {
      const firstCellIndex = i == 2 ? 9n : i == 1 ? 5n : 4n;
      const startMask = cellMask(firstCellIndex);

      const tx = await minesweeper.connect(signers.alice).newGame(2, firstCellIndex);
      await tx.wait();
      const clearBoard = computeDeterministicBoardWithMask(hre.ethers, BigInt(2), BigInt(i), startMask);

      const board = await minesweeper.connect(signers.alice).boardOf(signers.alice);
      const decryptedBoard = await debug.decrypt256(hre, board);

      const deterministic = await minesweeper.deterministic();
      expect(deterministic).to.equal(true);

      expect(clearBoard).to.equal(decryptedBoard);
    }
  });

  async function testLevel(level: bigint, count: bigint, firstCellIndex: bigint) {
    const tx0 = await minesweeper.connect(signers.alice).newGame(level, firstCellIndex);
    await tx0.wait();

    const clearBoard = computeDeterministicBoard(hre.ethers, level, count, firstCellIndex);
    const { rows, cols } = await minesweeper.size();
    expect(rows).to.equal(MINESWEEPER_ROWS);
    expect(cols).to.equal(MINESWEEPER_COLS);

    //printBoard(clearBoard);

    const boardCluesSolution = computeClueSolution(clearBoard, CELL_IS_BOMB_THRESHOLD);
    const boardBombsSolution = computeBombSolution(clearBoard);

    for (let i = 0; i < rows; ++i) {
      for (let j = 0; j < cols; ++j) {
        let tx = await minesweeper.connect(signers.alice).computeSixBitsAt(i, j);
        await tx.wait();

        const cellIndex = i * Number(cols) + j;

        tx = await minesweeper.connect(signers.alice).computeEncryptedCell(cellIndex);
        await tx.wait();

        const bomb = await minesweeper.uint8_0();
        const clue = await minesweeper.uint4_0();

        const decryptedBomb = await debug.decrypt8(hre, bomb);
        const decryptedClue = await debug.decrypt4(hre, clue);

        const computedBomb = decryptedClue >= BigInt(CELL_IS_BOMB_THRESHOLD) ? 1n : 0n;

        if (cellIndex === Number(firstCellIndex)) {
          expect(computedBomb).to.equal(0);
        }

        expect(computedBomb).to.equal(decryptedBomb);
        expect(decryptedBomb).to.equal(boardBombsSolution[cellIndex]);
        expect(decryptedClue).to.equal(boardCluesSolution[cellIndex]);
      }
    }

    const isDebug = await minesweeper.isDebug();

    if (isDebug) {
      const decryptedCache = await decryptCacheRows256(minesweeper.connect(signers.alice), Number(rows * cols));
      expect(decryptedCache).to.deep.equal(boardCluesSolution);
    }
  }

  async function decryptCacheRows256(contract: FHEMinesweeper, len: number) {
    const { eBlock0, eBlock1 } = await contract.connect(signers.alice).getEncryptedCache256x4();
    const decryptedcacheRow0: uint256 = await debug.decrypt256(hre, eBlock0);
    const decryptedcacheRow1: uint256 = await debug.decrypt256(hre, eBlock1);

    return parseCache256x4([decryptedcacheRow0, decryptedcacheRow1], len);
  }

  it("Test Level 0", async function () {
    await testLevel(0n, 0n, 16n);
  });

  it("Test Level 0x2", async function () {
    await testLevel(0n, 0n, 16n);
    await testLevel(0n, 1n, 19n);
  });

  it("Test Level 1", async function () {
    await testLevel(1n, 0n, 4n);
  });

  it("Test Level 2", async function () {
    await testLevel(2n, 0n, 4n);
  });

  it("Test Level 0 Density", async function () {
    const firstCellIndex = 0n;
    const tx0 = await minesweeper.connect(signers.alice).newGame(0n, firstCellIndex);
    await tx0.wait();

    const encBoard = await minesweeper.boardOf(signers.alice);
    const decryptedBoard = await debug.decrypt256(hre, encBoard);

    const clearBoard = computeDeterministicBoard(hre.ethers, BigInt(0), BigInt(0), firstCellIndex);

    expect(decryptedBoard).to.equal(clearBoard);

    const density = computeDensity(clearBoard);
    console.log(`Level 0 Dentity = ${density}`);
  });

  it("Test Level 1 Density", async function () {
    const firstCellIndex = 0n;
    const tx0 = await minesweeper.connect(signers.alice).newGame(1n, firstCellIndex);
    await tx0.wait();

    const encBoard = await minesweeper.boardOf(signers.alice);
    const decryptedBoard = await debug.decrypt256(hre, encBoard);

    const clearBoard = computeDeterministicBoard(hre.ethers, BigInt(1), BigInt(0), firstCellIndex);

    expect(decryptedBoard).to.equal(clearBoard);

    const density = computeDensity(clearBoard);
    console.log(`Level 1 Dentity = ${density}`);
  });

  it("Test Level 2 Density", async function () {
    const firstCellIndex = 0n;
    const tx0 = await minesweeper.connect(signers.alice).newGame(2n, firstCellIndex);
    await tx0.wait();

    const encBoard = await minesweeper.boardOf(signers.alice);
    const decryptedBoard = await debug.decrypt256(hre, encBoard);

    const clearBoard = computeDeterministicBoard(hre.ethers, BigInt(2), BigInt(0), firstCellIndex);

    expect(decryptedBoard).to.equal(clearBoard);

    const density = computeDensity(clearBoard);
    console.log(`Level 2 Dentity = ${density}`);
  });

  async function testLevelWithReveal(level: bigint, count: bigint, firstCellIndex: bigint) {
    const tx0 = await minesweeper.connect(signers.alice).newGame(level, firstCellIndex);
    await tx0.wait();

    const clearBoard = computeDeterministicBoard(hre.ethers, level, count, firstCellIndex);
    const { rows, cols } = await minesweeper.size();
    expect(rows).to.equal(MINESWEEPER_ROWS);
    expect(cols).to.equal(MINESWEEPER_COLS);

    const boardCluesSolution = computeClueSolution(clearBoard, CELL_IS_BOMB_THRESHOLD);

    for (let i = 0; i < rows; ++i) {
      for (let j = 0; j < cols; ++j) {
        const cellIndex = i * Number(cols) + j;

        let tx = await minesweeper.connect(signers.alice).computeEncryptedCell(cellIndex);
        await tx.wait();

        const bomb = await minesweeper.uint8_0();
        const clue = await minesweeper.uint4_0();

        const decryptedBomb = await debug.decrypt8(hre, bomb);
        const decryptedClue = await debug.decrypt4(hre, clue);

        if (decryptedBomb == 0n) {
          expect(decryptedClue).to.be.lessThan(CELL_IS_BOMB_THRESHOLD);
        } else {
          expect(decryptedClue).to.be.greaterThanOrEqual(CELL_IS_BOMB_THRESHOLD);
        }

        tx = await minesweeper.connect(signers.alice).revealCellMock(cellIndex);
        await tx.wait();

        await awaitAllDecryptionResults(hre);

        const clearCellPlusOne = await minesweeper.connect(signers.alice).getClearCacheValue4PlusOne(cellIndex);
        if (decryptedBomb > 0n) {
          expect(clearCellPlusOne - 1n).to.be.greaterThanOrEqual(CELL_IS_BOMB_THRESHOLD);
        } else {
          expect(clearCellPlusOne - 1n).to.equal(boardCluesSolution[cellIndex]);
        }

        if (await minesweeper.isDebug()) {
          const callbackCellPlusOne = await minesweeper
            .connect(signers.alice)
            .getDebugClearCellsPlusOne(signers.alice, cellIndex);
          expect(callbackCellPlusOne).to.equal(clearCellPlusOne);
        }
      }
    }

    //await printClearCache(minesweeper.connect(signers.alice), true, false);
  }

  async function winLevelWithReveal(level: bigint, count: bigint, firstCellIndex: bigint) {
    const tx0 = await minesweeper.connect(signers.alice).newGame(level, firstCellIndex);
    await tx0.wait();

    const clearBoard = computeDeterministicBoard(hre.ethers, level, count, firstCellIndex);
    const { rows, cols } = await minesweeper.size();
    expect(rows).to.equal(MINESWEEPER_ROWS);
    expect(cols).to.equal(MINESWEEPER_COLS);

    const boardCluesSolution = computeClueSolution(clearBoard, CELL_IS_BOMB_THRESHOLD);
    const boardBombsSolution = computeBombSolution(clearBoard);

    const gatewayDelayInSec = Number(await minesweeper.gatewayDelayInSec());

    for (let i = 0; i < rows; ++i) {
      for (let j = 0; j < cols; ++j) {
        const cellIndex = i * Number(cols) + j;

        if (boardBombsSolution[cellIndex] > 0) {
          continue;
        }

        const tx = await minesweeper.connect(signers.alice).revealCell(cellIndex);
        const receipt = await tx.wait();

        const ok1 = await minesweeper.isClearCellAvailable(signers.alice, cellIndex);
        expect(ok1).to.equal(false);

        const requestedCell = await minesweeper.connect(signers.alice).pendingDecryptionRequest();
        expect(requestedCell.cellIndexPlusOne).to.equal(cellIndex + 1);
        expect(requestedCell.maxBlockTimestamp).to.equal((await receipt!.getBlock()).timestamp + gatewayDelayInSec);
        expect(requestedCell.expired).to.equal(false);

        await awaitAllDecryptionResults(hre);

        const ok2 = await minesweeper.isClearCellAvailable(signers.alice, cellIndex);
        expect(ok2).to.equal(true);

        const clearCell = await minesweeper.connect(signers.alice).getClearCell(cellIndex);

        if (await minesweeper.isDebug()) {
          const callbackCellPlusOne = await minesweeper
            .connect(signers.alice)
            .getDebugClearCellsPlusOne(signers.alice, cellIndex);
          expect(callbackCellPlusOne).to.equal(clearCell + 1n);
        }

        expect(clearCell).to.equal(boardCluesSolution[cellIndex]);
      }
    }

    const victory = await minesweeper.connect(signers.alice).isItAVictory();
    expect(victory).to.equal(true);
    const gameover = await minesweeper.connect(signers.alice).isItGameOver();
    expect(gameover).to.equal(false);
  }

  it("Test Level 0 with reveal", async function () {
    await testLevelWithReveal(0n, 0n, 16n);
  });

  it("Test Level 1 with reveal", async function () {
    await testLevelWithReveal(1n, 0n, 4n);
  });

  it("Win Level 0 with reveal", async function () {
    await winLevelWithReveal(1n, 0n, 16n);
  });

  it("Win Level 1 with reveal", async function () {
    await winLevelWithReveal(1n, 0n, 4n);
  });

  it("Win Level 2 with reveal", async function () {
    await winLevelWithReveal(2n, 0n, 4n);
  });

  it("Test clear value cache", async function () {
    for (let i = 0; i < MINESWEEPER_COLS * MINESWEEPER_ROWS; ++i) {
      const v = await minesweeper.connect(signers.alice).getClearCacheValue4PlusOne(i);
      expect(v).to.equal(0);

      const tx = await minesweeper.connect(signers.alice).saveClearCache256x4(i, CELL_IS_BOMB_THRESHOLD);
      await tx.wait();

      const v2 = await minesweeper.connect(signers.alice).getClearCacheValue4PlusOne(i);
      expect(v2).to.equal(CELL_IS_BOMB_THRESHOLD + 1n);
    }
  });

  it("Test Bug", async function () {
    const tx0 = await minesweeper.connect(signers.alice).newGame(0, 0);
    await tx0.wait();

    const tx1 = await minesweeper.connect(signers.alice).revealCell(30);
    await tx1.wait();

    await awaitAllDecryptionResults(hre);

    const clearValue: bigint = await minesweeper.connect(signers.alice).getClearCell(30);
    console.log("clearValue[30] = " + clearValue);

    expect(clearValue).to.equal(0);

    const isGameOver = await minesweeper.isItGameOver();
    expect(isGameOver).to.equal(false);

    //await printClearCache(minesweeper.connect(signers.alice), false, true);
  });
});
