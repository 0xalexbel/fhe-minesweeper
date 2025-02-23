import assert from "assert";
import { expect } from "chai";
import hre from "hardhat";

import { computeDensity } from "../../src/fheminesweeper";
import { initGateway } from "../../src/hardhat/asyncDecrypt";
import { FHEMinesweeper } from "../../types";
import { Signers, getSigners, initSigners } from "../signers";
import { debug } from "../utils";
import { deployFHEMinesweeperFixture } from "./FHEMinesweeper.fixture";

describe("FHEMinesweeper.random", function () {
  let minesweeper: FHEMinesweeper;
  let signers: Signers;

  before(async function () {
    await initSigners();
    signers = await getSigners();
    await initGateway(hre);
  });

  beforeEach(async function () {
    const contract = await deployFHEMinesweeperFixture();
    minesweeper = contract;
  });

  it("Deterministic", async function () {
    const mode = await minesweeper.deterministic();
    expect(mode).to.equal(false);
    await minesweeper.setDeterministicMode(!mode);
    const newMode = await minesweeper.deterministic();
    expect(newMode).to.equal(!mode);
  });

  it("Level 2 Density", async function () {
    let total = 0.0;
    for (let i = 0; i < 50; ++i) {
      const tx = await minesweeper.connect(signers.alice).newGame(2, 0n);
      await tx.wait();
      const board = await minesweeper.connect(signers.alice).boardOf(signers.alice);
      const decryptedBoard = await debug.decrypt256(hre, board);

      total += computeDensity(decryptedBoard);
    }
    total = total / 50.0;
    expect(total >= 17.0 && total <= 20.0);
  });

  it("Level 1 Density", async function () {
    let total = 0.0;
    for (let i = 0; i < 50; ++i) {
      const tx = await minesweeper.connect(signers.alice).newGame(1, 0n);
      await tx.wait();
      const board = await minesweeper.connect(signers.alice).boardOf(signers.alice);
      const decryptedBoard = await debug.decrypt256(hre, board);

      total += computeDensity(decryptedBoard);
    }
    total = total / 50.0;
    expect(total >= 11.0 && total <= 13.0);
  });

  it("Level 0 Density", async function () {
    let total = 0.0;
    for (let i = 0; i < 50; ++i) {
      const tx = await minesweeper.connect(signers.alice).newGame(0, 0n);
      await tx.wait();
      const board = await minesweeper.connect(signers.alice).boardOf(signers.alice);
      assert(board !== undefined);
      const decryptedBoard = await debug.decrypt256(hre, board);

      total += computeDensity(decryptedBoard);
    }
    total = total / 50.0;
    expect(total >= 8.0 && total <= 10.5);
  });
});
