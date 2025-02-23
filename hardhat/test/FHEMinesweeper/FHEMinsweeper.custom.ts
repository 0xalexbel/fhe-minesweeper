import { expect } from "chai";
import { AddressLike } from "ethers";
import { FhevmInstance } from "fhevmjs/node";
import hre from "hardhat";

import { MINESWEEPER_COLS, MINESWEEPER_ROWS, setBombAt } from "../../src/fheminesweeper";
import { awaitAllDecryptionResults, initGateway } from "../../src/hardhat/asyncDecrypt";
import { createInstance } from "../../src/hardhat/instance";
import { FHEMinesweeper } from "../../types";
import { Signers, getSigners, initSigners } from "../signers";
import { debug } from "../utils";
import { deployFHEMinesweeperFixture } from "./FHEMinesweeper.fixture";

describe("FHEMinesweeper.custom", function () {
  let minesweeper: FHEMinesweeper;
  let minesweeperAddr: string;
  let signers: Signers;
  let fhevm: FhevmInstance;

  before(async function () {
    await initSigners();
    signers = await getSigners();
    await initGateway(hre);
  });

  beforeEach(async function () {
    const contract = await deployFHEMinesweeperFixture();
    minesweeper = contract;
    minesweeperAddr = await minesweeper.getAddress();
    fhevm = await createInstance(hre);
  });

  async function newCustomGame(player: AddressLike, board: bigint) {
    const input = fhevm.createEncryptedInput(minesweeperAddr, signers.alice.address);
    input.add256(board);
    const encBoard = await input.encrypt();

    const firstCellIndex = 1n;
    const tx = await minesweeper
      .connect(signers.alice)
      .newCustomGame(signers.bob.address, firstCellIndex, encBoard.handles[0], encBoard.inputProof);
    const receipt = await tx.wait();

    return receipt;
  }

  it("Create custom board", async function () {
    await newCustomGame(signers.bob, 1n);

    const encBoard = await minesweeper.boardOf(signers.bob);
    const clearBoard = await debug.decrypt256(hre, encBoard);
    expect(clearBoard).to.eq(1n);
  });

  it("Play with a custom board", async function () {
    let board = 0n;
    for (let i = 0n; i < MINESWEEPER_ROWS; ++i) {
      board = setBombAt(board, i * MINESWEEPER_COLS);
      board = setBombAt(board, i * MINESWEEPER_COLS + MINESWEEPER_COLS - 1n);
    }

    await newCustomGame(signers.bob, board);

    const encBoard = await minesweeper.boardOf(signers.bob);
    const clearBoard = await debug.decrypt256(hre, encBoard);
    expect(clearBoard).to.eq(board);

    for (let i = 0n; i < MINESWEEPER_ROWS; ++i) {
      for (let j = 1n; j < MINESWEEPER_COLS - 1n; ++j) {
        const cellIndex = i * MINESWEEPER_COLS + j;

        const tx = await minesweeper.connect(signers.bob).revealCell(cellIndex);
        await tx.wait();

        await awaitAllDecryptionResults(hre);
      }
    }

    const ok = await minesweeper.connect(signers.bob).isItAVictory();
    expect(ok).to.eq(true);
  });
});
