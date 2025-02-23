import { expect } from "chai";
import hre from "hardhat";

import {
  BLOCK_INTERVAL_S,
  CELL_IS_BOMB_THRESHOLD,
  GATEWAY_INTERVAL_MS,
  MINESWEEPER_COLS,
  MINESWEEPER_ROWS,
  computeBombSolution,
  computeClueSolution,
  computeDeterministicBoard,
  parseCache256x4,
} from "../../src/fheminesweeper";
import { FHEMinesweeperSimulator } from "../../src/simulator";
import { address, uint4, uint8, uint256 } from "../../src/sol";
import { TFHE, euint256 } from "../../src/tfhe";
import { Signers, getSigners, initSigners } from "../signers";
import { DEFAULT_LEVEL_0_FIRST_CELL, DEFAULT_LEVEL_1_FIRST_CELL, DEFAULT_LEVEL_2_FIRST_CELL } from "./constants";

describe("FHEMinesweeperSimulator", function () {
  let signers: Signers;

  before(async function () {
    expect(hre.network.name == "hardhat");
    await initSigners();
    signers = await getSigners();
  });

  function testBoardLevel(level: uint8, firstCellIndex: uint8) {
    const simulator = new FHEMinesweeperSimulator(hre.ethers, {
      gatewayIntervalMs: GATEWAY_INTERVAL_MS,
      blockIntervalInSec: BLOCK_INTERVAL_S,
    });
    for (let i = 0; i < 1; ++i) {
      if (i > 0) {
        const prevBoard = simulator.boardOf(BigInt(signers.alice.address));
        expect(TFHE.isInitialized(prevBoard)).to.equal(true);
      }
      simulator.callMethod(signers.alice.address, "newGame", level, firstCellIndex);

      const clearBoard = computeDeterministicBoard(hre.ethers, level, BigInt(i), firstCellIndex);

      const board = simulator.boardOf(BigInt(signers.alice.address));
      const decryptedBoard = board.value;

      const deterministic = simulator.deterministic();
      expect(deterministic).to.equal(true);

      // printBoard(clearBoard);
      // printBoard(decryptedBoard);
      expect(clearBoard).to.equal(decryptedBoard);
    }
  }

  it("Simulator: Level 0 Generated board should be valid", async function () {
    testBoardLevel(0n, DEFAULT_LEVEL_0_FIRST_CELL);
  });

  it("Simulator: Level 1 Generated board should be valid", async function () {
    testBoardLevel(1n, DEFAULT_LEVEL_1_FIRST_CELL);
  });

  it("Simulator: Level 2 Generated board should be valid", async function () {
    testBoardLevel(2n, DEFAULT_LEVEL_2_FIRST_CELL);
  });

  function testLevel(level: bigint, count: bigint, firstCellIndex: bigint) {
    const simulator = new FHEMinesweeperSimulator(hre.ethers, {
      gatewayIntervalMs: GATEWAY_INTERVAL_MS,
      blockIntervalInSec: BLOCK_INTERVAL_S,
    });
    simulator.callMethod(signers.alice.address, "newGame", level, firstCellIndex);

    const gameInProgress = simulator.playerHasGameInProgress(BigInt(signers.alice.address));
    expect(gameInProgress).to.equal(true);

    const clearBoard = computeDeterministicBoard(hre.ethers, level, count, firstCellIndex);
    const { rows, cols } = simulator.size();
    expect(rows).to.equal(MINESWEEPER_ROWS);
    expect(cols).to.equal(MINESWEEPER_COLS);

    const boardCluesSolution: uint4[] = computeClueSolution(clearBoard, CELL_IS_BOMB_THRESHOLD);
    const boardBombsSolution: uint4[] = computeBombSolution(clearBoard);

    //printArray(boardCluesSolution);

    const player: address = BigInt(signers.alice.address);
    const board: euint256 = simulator.boardOf(player);
    const decryptedClues: uint4[] = [];

    for (let i: uint8 = 0n; i < rows; ++i) {
      for (let j: uint8 = 0n; j < cols; ++j) {
        simulator.computeSixBitsAt(player, i, j);
        const cellIndex: uint8 = i * cols + j;
        const { isBomb, clue } = simulator._computeEncryptedCell(player, board, cellIndex, true);
        const decryptedBomb = isBomb.value;
        const decryptedClue = clue.value;
        const computedBomb = decryptedClue >= BigInt(CELL_IS_BOMB_THRESHOLD) ? 1n : 0n;
        expect(computedBomb).to.equal(decryptedBomb);
        expect(decryptedBomb).to.equal(boardBombsSolution[Number(cellIndex)]);

        decryptedClues.push(decryptedClue);
        expect(decryptedClue).to.equal(boardCluesSolution[Number(cellIndex)]);
      }
    }

    expect(decryptedClues).to.deep.equal(boardCluesSolution);

    const { cacheRow0, cacheRow1 } = simulator.getEncryptedCacheRows256(player);
    const decryptedcacheRow0: uint256 = cacheRow0.value;
    const decryptedcacheRow1: uint256 = cacheRow1.value;

    const decryptedCache = parseCache256x4([decryptedcacheRow0, decryptedcacheRow1], Number(rows * cols));

    //printArray(decryptedCache);

    expect(decryptedCache).to.deep.equal(boardCluesSolution);
  }

  it("Simulator Test Level 0", async function () {
    testLevel(0n, 0n, DEFAULT_LEVEL_0_FIRST_CELL);
  });

  it("Simulator Test Level 1", async function () {
    testLevel(1n, 0n, DEFAULT_LEVEL_1_FIRST_CELL);
  });

  it("Simulator Test Level 2", async function () {
    testLevel(2n, 0n, DEFAULT_LEVEL_2_FIRST_CELL);
  });

  async function testLevelWithReveal(level: bigint, count: bigint, firstCellIndex: bigint) {
    const simulator = new FHEMinesweeperSimulator(hre.ethers, {
      gatewayIntervalMs: 0,
      blockIntervalInSec: BLOCK_INTERVAL_S,
    });
    simulator.callMethod(signers.alice.address, "newGame", level, firstCellIndex);

    const gameInProgress = simulator.playerHasGameInProgress(BigInt(signers.alice.address));
    expect(gameInProgress).to.equal(true);

    const clearBoard = computeDeterministicBoard(hre.ethers, level, count, firstCellIndex);
    const { rows, cols } = simulator.size();
    expect(rows).to.equal(MINESWEEPER_ROWS);
    expect(cols).to.equal(MINESWEEPER_COLS);

    const boardCluesSolution = computeClueSolution(clearBoard, CELL_IS_BOMB_THRESHOLD);

    const player: address = BigInt(signers.alice.address);
    const board: euint256 = simulator.boardOf(player);

    for (let i = 0n; i < rows; ++i) {
      for (let j = 0n; j < cols; ++j) {
        const cellIndex = i * cols + j;
        simulator.computeSixBitsAt(player, i, j);
        const { isBomb, clue } = simulator._computeEncryptedCell(player, board, cellIndex, true);
        const decryptedBomb = isBomb.value;
        const decryptedClue = clue.value;
        if (decryptedBomb == 0n) {
          expect(decryptedClue).to.be.lessThan(CELL_IS_BOMB_THRESHOLD);
        } else {
          expect(decryptedClue).to.be.greaterThanOrEqual(CELL_IS_BOMB_THRESHOLD);
        }

        const gatewayPromise: Promise<void> = simulator.callMethod(
          signers.alice.address,
          "revealCellOf",
          BigInt(signers.alice.address),
          cellIndex,
        );

        // Equivalent to awaitAllDecryptionResults
        await gatewayPromise;

        const clearCellPlusOne = simulator._getClearCachedValue4PlusOne(player, cellIndex);
        if (decryptedBomb > 0n) {
          expect(clearCellPlusOne - 1n).to.be.greaterThanOrEqual(CELL_IS_BOMB_THRESHOLD);
        } else {
          expect(clearCellPlusOne - 1n).to.equal(boardCluesSolution[Number(cellIndex)]);
        }

        const callbackCellPlusOne = simulator.getDebugClearCluesPlusOne(BigInt(signers.alice.address), cellIndex);
        expect(callbackCellPlusOne).to.equal(clearCellPlusOne);
      }
    }

    const afterGameInProgress = simulator.playerHasGameInProgress(BigInt(signers.alice.address));
    expect(afterGameInProgress).to.equal(false);

    //printCache4x256(simulator.getClearCacheRows256Of(BigInt(signers.alice.address)), Number(simulator.cellCount()));
  }

  it("Simulator Test Level 0 with reveal", async function () {
    await testLevelWithReveal(0n, 0n, DEFAULT_LEVEL_0_FIRST_CELL);
  });

  it("Simulator Test Level 1 with reveal", async function () {
    await testLevelWithReveal(1n, 0n, DEFAULT_LEVEL_1_FIRST_CELL);
  });

  it("Simulator Test Level 2 with reveal", async function () {
    await testLevelWithReveal(2n, 0n, DEFAULT_LEVEL_2_FIRST_CELL);
  });
});
