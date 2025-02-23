import hre from "hardhat";

import * as fhevm from "../../src/fhevm";

describe("FHEMinesweeper.task", function () {
  before(async function () {
    // Because tasks are using the deploy plug-in
    await hre.run("deploy");
    await fhevm.initGateway(hre, 1000 /* autoDecryptIntervalMS */);
  });

  after(async function () {
    await fhevm.closeGateway(hre);
  });

  it("Custom + Play", async function () {
    await hre.run({ scope: "minesweeper", task: "resign" }, { player: "0" });
    await hre.run({ scope: "minesweeper", task: "create" }, { creator: "1", player: "0" });
    await hre.run({ scope: "minesweeper", task: "play" }, { row: 0, col: 0 });
    await hre.run({ scope: "minesweeper", task: "play" }, { row: 1, col: 0 });
    await hre.run({ scope: "minesweeper", task: "play" }, { row: 1, col: 1 });
  });

  it("New Game + Play", async function () {
    await hre.run({ scope: "minesweeper", task: "new-game" }, { deterministic: true, level: 0 });
    await hre.run({ scope: "minesweeper", task: "play" }, { row: 0, col: 0 });
    await hre.run({ scope: "minesweeper", task: "play" }, { row: 0, col: 1 });
    await hre.run({ scope: "minesweeper", task: "play" }, { row: 1, col: 0 });
  });
});
