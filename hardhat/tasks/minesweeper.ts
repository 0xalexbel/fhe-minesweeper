import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import cliProgress from "cli-progress";
import { scope, types } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import {
  MINESWEEPER_COLS,
  defaultBoard,
  getPastCellRevealedEvents,
  printBoard,
  printCache256x4WithColor,
} from "../src/fheminesweeper";
import { createInstance } from "../src/fhevm";
import { FHEMinesweeper } from "../types";
import { FHEMinesweeperError } from "./error";

const minesweeperScope = scope("minesweeper", "Minesweeper related commands");

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForChain(hre: HardhatRuntimeEnvironment) {
  if (hre.network.name === "hardhat" || hre.network.name === "localhost") {
    return sleep(1000);
  }
  return sleep(7000);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function convertToAddress(hre: HardhatRuntimeEnvironment, addrOrIndex: any): Promise<string | undefined> {
  const signers = await hre.ethers.getSigners();
  if (typeof addrOrIndex !== "string") {
    return undefined;
  }
  let address = undefined;
  try {
    address = hre.ethers.getAddress(addrOrIndex);
  } catch {
    address = undefined;
  }

  if (!address) {
    const signerIndex = Number.parseInt(addrOrIndex, 10);
    if (Number.isNaN(signerIndex)) {
      return undefined;
    }
    address = signers[signerIndex].address;
  }
  return address;
}

export async function convertToAddressOrThrow(
  hre: HardhatRuntimeEnvironment,
  addrOrIndex: any,
  messagePrefix?: string,
): Promise<string> {
  const addr = await convertToAddress(hre, addrOrIndex);
  if (!addr) {
    throw new FHEMinesweeperError(
      `Unable to resolve address '${addrOrIndex}', expecting a valid address or a valid signer index.`,
      messagePrefix,
    );
  }
  return addr;
}

export async function resolveSignerOrThrow(hre: HardhatRuntimeEnvironment, addrOrIndex: any, messagePrefix?: string) {
  const address = await convertToAddressOrThrow(hre, addrOrIndex, messagePrefix);

  const signer: HardhatEthersSigner = await HardhatEthersSigner.create(hre.ethers.provider, address);

  return signer;
}

/**
 *  npx hardhat --network localhost minesweeper enable-deterministic
 */
minesweeperScope
  .task("enable-deterministic")
  .setAction(async function (taskArguments: TaskArguments, hre: HardhatRuntimeEnvironment) {
    const { ethers, deployments } = hre;
    const minesweeperDeployment = await deployments.get("FHEMinesweeper");
    const signers = await ethers.getSigners();
    const minesweeper = (await ethers.getContractAt("FHEMinesweeper", minesweeperDeployment.address)) as FHEMinesweeper;

    const tx = await minesweeper.connect(signers[0]).setDeterministicMode(true);
    const receipt = await tx.wait(1);

    // Verify
    const isDetermninistic = await minesweeper.connect(signers[0]).deterministic();
    console.info("Enable Deterministic Mode tx hash: ", receipt!.hash);

    if (!isDetermninistic) {
      console.error("The Derministic Mode is not yet enabled on-chain");
    } else {
      console.info("The Deterministic Mode is enabled on-chain");
    }
  });

/**
 *  npx hardhat --network localhost minesweeper disable-deterministic
 */
minesweeperScope
  .task("disable-deterministic")
  .setAction(async function (taskArguments: TaskArguments, hre: HardhatRuntimeEnvironment) {
    const { ethers, deployments } = hre;
    const minesweeperDeployment = await deployments.get("FHEMinesweeper");
    const signers = await ethers.getSigners();
    const minesweeper = (await ethers.getContractAt("FHEMinesweeper", minesweeperDeployment.address)) as FHEMinesweeper;

    const tx = await minesweeper.connect(signers[0]).setDeterministicMode(false);
    const receipt = await tx.wait();

    // Verify
    const isDetermninistic = await minesweeper.connect(signers[0]).deterministic();
    console.info("Disable Deterministic Mode tx hash: ", receipt!.hash);

    if (isDetermninistic) {
      console.error("The Derministic Mode is not yet disabled on-chain");
    } else {
      console.info("The Deterministic Mode is disabled on-chain");
    }
  });

/**
 *  npx hardhat --network localhost minesweeper new-game --deterministic --level 0
 */
minesweeperScope
  .task("new-game")
  .addOptionalParam("player", "The player's address")
  .addFlag("waitForEvents")
  .addFlag("deterministic")
  .addParam("row", "Row index of the first selected cell", 5, types.int)
  .addParam("col", "Column index of the first selected cell", 5, types.int)
  .addOptionalParam("level", "Game level (0, 1, 2)", 0, types.int)
  .setAction(async function (taskArguments: TaskArguments, hre: HardhatRuntimeEnvironment) {
    let level = 0n;
    if (taskArguments.level !== undefined) {
      level = BigInt(taskArguments.level);
    }
    if (level >= 3) {
      console.error(`Invalid '--level' argument (level=${level} > 2)`);
      return;
    }

    if (taskArguments.row === undefined) {
      console.error(`Invalid '--row' argument`);
      return;
    }
    if (taskArguments.col === undefined) {
      console.error(`Invalid '--col' argument`);
      return;
    }

    const row: bigint = BigInt(taskArguments.row);
    const col: bigint = BigInt(taskArguments.col);

    const { ethers, deployments } = hre;
    const minesweeperDeployment = await deployments.get("FHEMinesweeper");
    const signers = await ethers.getSigners();
    const minesweeper = (await ethers.getContractAt("FHEMinesweeper", minesweeperDeployment.address)) as FHEMinesweeper;

    if (taskArguments.deterministic === true) {
      await hre.run({ scope: "minesweeper", task: "enable-deterministic" });
    }

    let player = signers[0];
    if (taskArguments.player !== undefined) {
      player = await resolveSignerOrThrow(hre, taskArguments.player);
    }

    const sz = await minesweeper.size();
    const rowMax = BigInt(sz.rows);
    const colMax = BigInt(sz.cols);

    if (row >= rowMax) {
      console.error(`Invalid '--row' argument (row=${row} >= ${rowMax})`);
      return;
    }
    if (col >= colMax) {
      console.error(`Invalid '--col' argument (row=${col} >= ${colMax})`);
      return;
    }

    const cellIndex = row * colMax + col;

    const tx0 = await minesweeper.connect(player).newGame(level, cellIndex);
    const receipt0 = await tx0.wait();

    console.info("New Game tx hash: ", receipt0!.hash);
    console.info(`First selected cell at row=${row} col=${col} index=${cellIndex}`);

    // Play the first cell
    await hre.run(
      { scope: "minesweeper", task: "play" },
      { row: Number(row), col: Number(col), waitForEvents: taskArguments.waitForEvents },
    );
  });

/**
 *  npx hardhat --network localhost minesweeper print-board
 */
minesweeperScope
  .task("print-board", "Prints the current board")
  .addOptionalParam("player", "The player's address")
  .setAction(async function (taskArguments: TaskArguments, hre: HardhatRuntimeEnvironment) {
    const { ethers, deployments } = hre;
    const minesweeperDeployment = await deployments.get("FHEMinesweeper");
    const signers = await ethers.getSigners();
    const minesweeper = (await ethers.getContractAt("FHEMinesweeper", minesweeperDeployment.address)) as FHEMinesweeper;

    let player = signers[0];
    if (taskArguments.player !== undefined) {
      player = await resolveSignerOrThrow(hre, taskArguments.player);
    }

    const hasGameInProgress = await minesweeper.connect(player).playerHasGameInProgress(player);
    if (!hasGameInProgress) {
      console.info(`No game in progress for player ${player.address}`);
      return;
    }

    const victory = await minesweeper.connect(player).isItAVictory();
    if (victory) {
      console.info(`Player ${player.address} won the game!`);
      return;
    }

    const gameOver = await minesweeper.connect(player).isItGameOver();
    if (gameOver) {
      console.error(`Player ${player.address} lost the game!`);
      return;
    }

    const pendingRequest = await minesweeper.connect(player).pendingDecryptionRequest();
    const pendingCellDecryption =
      pendingRequest.cellIndexPlusOne === 0n ? undefined : Number(pendingRequest.cellIndexPlusOne - 1n);

    const sz = await minesweeper.size();
    const rowMax = BigInt(sz.rows);
    const colMax = BigInt(sz.cols);

    const cache = await minesweeper.connect(player).getClearCache256x4();
    printCache256x4WithColor(cache, Number(rowMax * colMax), pendingCellDecryption);
  });

/**
 *  npx hardhat --network localhost minesweeper play --row 0 --col 0
 */
minesweeperScope
  .task("play")
  .addFlag("waitForEvents")
  .addOptionalParam("player", "The player's address")
  .addParam("row", "Cell row", undefined, types.int)
  .addParam("col", "Cell column", undefined, types.int)
  .setAction(async function (taskArguments: TaskArguments, hre: HardhatRuntimeEnvironment) {
    if (taskArguments.row === undefined) {
      console.error(`Invalid '--row' argument`);
      return;
    }
    if (taskArguments.col === undefined) {
      console.error(`Invalid '--col' argument`);
      return;
    }

    const row: bigint = BigInt(taskArguments.row);
    const col: bigint = BigInt(taskArguments.col);

    const { ethers, deployments } = hre;
    const minesweeperDeployment = await deployments.get("FHEMinesweeper");
    const signers = await ethers.getSigners();

    let player = signers[0];
    if (taskArguments.player !== undefined) {
      player = await resolveSignerOrThrow(hre, taskArguments.player);
    }

    const minesweeper = (await ethers.getContractAt("FHEMinesweeper", minesweeperDeployment.address)) as FHEMinesweeper;

    const hasGameInProgress = await minesweeper.connect(player).playerHasGameInProgress(player);
    if (!hasGameInProgress) {
      console.error(`Player ${player.address} has no game in progress.`);
      return;
    }

    const sz = await minesweeper.size();
    const rowMax = BigInt(sz.rows);
    const colMax = BigInt(sz.cols);

    if (row >= rowMax) {
      console.error(`Invalid '--row' argument (row=${row} >= ${rowMax})`);
      return;
    }
    if (col >= colMax) {
      console.error(`Invalid '--col' argument (row=${col} >= ${colMax})`);
      return;
    }

    const cellIndex = row * colMax + col;

    const ok = await minesweeper.connect(player).isClearCellAvailable(player, cellIndex);
    if (ok) {
      const cache = await minesweeper.connect(player).getClearCache256x4();
      printCache256x4WithColor(cache, Number(rowMax * colMax));
      return;
    }

    const victory = await minesweeper.connect(player).isItAVictory();
    if (victory) {
      console.info(`Player ${player.address} won the game!`);
      return;
    }

    const gameOver = await minesweeper.connect(player).isItGameOver();
    if (gameOver) {
      console.error(`Player ${player.address} lost the game!`);
      return;
    }

    const pendingRequest = await minesweeper.connect(player).pendingDecryptionRequest();

    let revealCell = pendingRequest.cellIndexPlusOne === 0n;
    let actualCellIndex = cellIndex;

    if (pendingRequest.cellIndexPlusOne > 0) {
      actualCellIndex = pendingRequest.cellIndexPlusOne - 1n;
      if (pendingRequest.expired) {
        revealCell = true;
        if (actualCellIndex === cellIndex) {
          console.error(
            `Pending decryption request of cell ${actualCellIndex} has expired. The cell ${actualCellIndex} will be played again.`,
          );
        } else {
          console.error(
            `Pending decryption request of cell ${actualCellIndex} has expired. The cell ${actualCellIndex} will be played again instead of the requested cell ${cellIndex}.`,
          );
        }
      }
    }

    if (revealCell) {
      const tx = await minesweeper.connect(player).revealCell(actualCellIndex);
      const receipt = await tx.wait();

      console.info(`Reveal Cell ${actualCellIndex} tx hash: `, receipt!.hash);
    }

    let progressBar;

    if (taskArguments.waitForEvents) {
      console.log("🕑 Waiting for EVM event...");
      progressBar = new cliProgress.SingleBar(
        { stopOnComplete: true, clearOnComplete: true },
        cliProgress.Presets.shades_classic,
      );
      progressBar.start(100, 0);

      for (let i = 0; i < 100; ++i) {
        try {
          const logs = await getPastCellRevealedEvents(
            hre.ethers,
            hre.ethers.provider,
            minesweeperDeployment.address,
            player.address,
            Number(actualCellIndex),
          );
          if (logs && logs.length > 0) {
            progressBar.update(100);
            console.info(
              `✅ CellRevealed Event: from=${minesweeperDeployment.address}, player=${logs[0].player}, cellIndex=${logs[0].cellIndex}, victory=${logs[0].victory}, cellValue=${logs[0].cellValue}`,
            );
            break;
          }
        } catch (error) {
          console.error(error);
        }
        await waitForChain(hre);
        progressBar.update(i + 1);
      }
    }

    if (!revealCell) {
      console.log(`🕑 Still waiting for decryption of cell #${actualCellIndex} ...`);
    } else {
      console.log(`🕑 Waiting for decryption of cell #${actualCellIndex} ...`);
    }

    /*
    in hardhat mode : awaitForDecryptions... here!!
    */

    progressBar = new cliProgress.SingleBar(
      { stopOnComplete: true, clearOnComplete: true },
      cliProgress.Presets.shades_classic,
    );
    progressBar.start(100, 0);

    for (let i = 0; i < 100; ++i) {
      const ok = await minesweeper.connect(player).isClearCellAvailable(player, actualCellIndex);
      if (ok) {
        progressBar.update(100);
        console.info(`✅ Cell at row=${row} col=${col} (index=${actualCellIndex}) is now decrypted.`);

        const cache = await minesweeper.connect(player).getClearCache256x4();
        printCache256x4WithColor(cache, Number(rowMax * colMax));

        return;
      }
      await waitForChain(hre);
      progressBar.update(i + 1);
    }

    console.error(`Cell at row=${row} col=${col} (index=${actualCellIndex}) is not decrypted.`);
  });

/**
 *  npx hardhat --network localhost minesweeper resign
 */
minesweeperScope
  .task("resign", "Allow the player to resign form their current active game")
  .addOptionalParam("player", "The player's address")
  .setAction(async function (taskArguments: TaskArguments, hre: HardhatRuntimeEnvironment) {
    const { ethers, deployments } = hre;
    const minesweeperDeployment = await deployments.get("FHEMinesweeper");
    const signers = await ethers.getSigners();
    const minesweeper = (await ethers.getContractAt("FHEMinesweeper", minesweeperDeployment.address)) as FHEMinesweeper;

    let player = signers[0];
    if (taskArguments.player !== undefined) {
      player = await resolveSignerOrThrow(hre, taskArguments.player);
    }

    const tx = await minesweeper.connect(player).resign();
    const receipt = await tx.wait();

    console.info(`Resign game player: ${player.address} tx hash: `, receipt!.hash);
  });

/**
 *  npx hardhat --network localhost minesweeper game-infos
 */
minesweeperScope
  .task("game-infos", "Prints the current game infos")
  .addOptionalParam("player", "The player's address")
  .setAction(async function (taskArguments: TaskArguments, hre: HardhatRuntimeEnvironment) {
    const { ethers, deployments } = hre;
    const minesweeperDeployment = await deployments.get("FHEMinesweeper");
    const signers = await ethers.getSigners();
    const minesweeper = (await ethers.getContractAt("FHEMinesweeper", minesweeperDeployment.address)) as FHEMinesweeper;

    let player = signers[0];
    if (taskArguments.player !== undefined) {
      player = await resolveSignerOrThrow(hre, taskArguments.player);
    }

    const hasGameInProgress = await minesweeper.connect(player).playerHasGameInProgress(player);
    if (!hasGameInProgress) {
      console.info(`No game in progress for player ${player.address}`);
      return;
    }

    const victory = await minesweeper.connect(player).isItAVictory();
    const gameOver = await minesweeper.connect(player).isItGameOver();
    const sz = await minesweeper.size();
    const firstCellIndex = await minesweeper.getFirstCellIndex();
    const pendingRequest = await minesweeper.connect(player).pendingDecryptionRequest();
    const blockTimestamp = (await hre.ethers.provider.getBlock("latest"))?.timestamp;

    console.info(`Player             : ${player.address}`);
    if (pendingRequest.cellIndexPlusOne > 0) {
      console.info(
        `Decryption request : cell=${pendingRequest.cellIndexPlusOne}, expired=${pendingRequest.expired}, delay=${pendingRequest.maxBlockTimestamp}/${blockTimestamp}`,
      );
    } else {
      console.info(`Decryption request : no`);
    }
    console.info(`First cell         : ${firstCellIndex}`);
    console.info(`Victory            : ${victory}`);
    console.info(`Game Over          : ${gameOver}`);
    console.info(`Board size         : ${sz.rows}x${sz.cols}`);
  });

/**
 *  npx hardhat --network localhost minesweeper create --board 0  --player 0xD9F9298BbcD72843586e7E08DAe577E3a0aC8866
 */
minesweeperScope
  .task("create", "Create a custom board")
  .addOptionalParam("board", "Board as a uint256", undefined, types.bigint)
  .addOptionalParam("creator", "The address of the board creator")
  .addParam("player", "The address of the future player", undefined, types.string)
  .setAction(async function (taskArguments: TaskArguments, hre: HardhatRuntimeEnvironment) {
    const minesweeperDeployment = await hre.deployments.get("FHEMinesweeper");
    const signers = await hre.ethers.getSigners();
    const minesweeper = (await hre.ethers.getContractAt(
      "FHEMinesweeper",
      minesweeperDeployment.address,
    )) as FHEMinesweeper;

    const player = await convertToAddressOrThrow(hre, taskArguments.player);

    let creator = signers[0];
    if (taskArguments.creator !== undefined) {
      creator = await resolveSignerOrThrow(hre, taskArguments.creator);
    }

    console.log(`Creator is ${creator.address}`);
    console.log(`Player is ${player}`);

    //npx hardhat --network localhost minesweeper create  --creator 0 --player 3
    //npx hardhat --network localhost minesweeper play --player 0x28e2bD235e7831b71AF247D452340B6127627131 --row 1 --col 1

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

    let board = 0n;
    if (taskArguments.board !== undefined) {
      board = hre.ethers.toBigInt(hre.ethers.toBeHex(taskArguments.board, 32));
    } else {
      board = defaultBoard();
    }

    printBoard(board);

    console.log(`Check if ${player} has a game in progress...`);
    const hasGameInProgress = await minesweeper.connect(creator).playerHasGameInProgress(player);
    if (hasGameInProgress) {
      console.error(`Player ${player} has a game in progress`);
      return;
    }

    console.log(`Create encrypted input, it might take a while 🍔🍟🥤 please wait ...`);

    const fhevm = await createInstance(hre);
    const input = fhevm.createEncryptedInput(minesweeperDeployment.address, creator.address);
    input.add256(board);
    const encBoard = await input.encrypt();

    console.log(hre.ethers.toBigInt(encBoard.handles[0]));

    console.log(`Creating custom game for player ${player} ...`);

    const firstCellRow = 7n;
    const firstCellCol = 5n;
    const firstCellIndex = firstCellRow * MINESWEEPER_COLS + firstCellCol;
    const tx = await minesweeper
      .connect(creator)
      .newCustomGame(player, firstCellIndex, encBoard.handles[0], encBoard.inputProof);
    await tx.wait();

    console.log(`First cell is : ${firstCellIndex} (row=${firstCellRow}, col=${firstCellRow})`);

    console.log(`🧩 Player ${player} can now play your game! `);
  });

minesweeperScope
  .task("encrypt", "Test encrypt")
  .setAction(async function (taskArguments: TaskArguments, hre: HardhatRuntimeEnvironment) {
    const minesweeperDeployment = await hre.deployments.get("FHEMinesweeper");
    const signers = await hre.ethers.getSigners();

    console.log(`1. createInstance...`);

    const fhevm = await createInstance(hre);

    console.log(`2. createEncryptedInput...`);

    const input = fhevm.createEncryptedInput(minesweeperDeployment.address, signers[0].address);
    input.add256(1234n);

    console.log(`3. encrypt...`);

    const encBoard = await input.encrypt();

    console.log(`Result = ${encBoard.handles[0]}`);
  });

minesweeperScope
  .task("print-default-board", "Print default board")
  .setAction(async function (taskArguments: TaskArguments, hre: HardhatRuntimeEnvironment) {
    const board = defaultBoard();
    console.info(`Default board (hex) = ${hre.ethers.toBeHex(board)}`);
    console.info(`Default board (num) = ${board}`);
    printBoard(defaultBoard());
  });
