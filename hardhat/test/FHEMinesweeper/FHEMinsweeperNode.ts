import { expect } from "chai";
import { ParamType, ethers } from "ethers";
import { FhevmInstance } from "fhevmjs/node";
import hre from "hardhat";

import { FHEMinesweeper, FHEMinesweeperMock } from "../../types";
import { awaitAllDecryptionResults, initGateway } from "../asyncDecrypt";
import { createInstance } from "../instance";
import { reencryptEuint256 } from "../reencrypt";
import { Signers, getSigners, initSigners } from "../signers";
import { debug } from "../utils";
import { deployFHEMinesweeperFixture } from "./FHEMinesweeper.fixture";
import { FHEMinesweeperSimulator } from "./FHEMinesweeper.simulator";

const ROWS = 11;
const COLS = 11;
const BITS_PER_CELL = 2;
const BITS_PER_ROW = BigInt(BITS_PER_CELL * COLS);
const CELL_IS_BOMB_THRESHOLD = 0x9;

describe("FHEMinesweeper", function () {
  let minesweeperAddress: string;
  let minesweeper: FHEMinesweeper;
  let fhevm: FhevmInstance;
  let signers: Signers;

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

  before(async function () {
    expect(hre.network.name == "hardhat");
    await initSigners();
    signers = await getSigners();
    minesweeperAddress = "0x7553cb9124f974ee475e5ce45482f90d5b6076bc";
    minesweeper = await hre.ethers.getContractAt("FHEMinesweeper", minesweeperAddress, signers.alice);
    fhevm = await createInstance();
  });

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

  it("BBB Print board", async function () {
    const board = 6901746449760238734457329842420072797653689415222698747690205881303041n;
    printBoard(board);
  });

  it("Test2", async function () {
    // const board = 448721464640671236880907976639495329093629697800122135872536537345310737n;
    // printBoard(board);
    /* Player: 0x37AC010c1c566696326813b840319B58Bb5840E4
    Contract: 0xC24e49E5A512f8C923B0677C8e75D0730794f75f
(0)  1 0 1 0 0 0 0 1 0 0 0 
(1)  0 0 0 0 0 1 0 1 0 1 0 
(2)  0 0 0 0 0 0 0 1 0 0 0 
(3)  0 1 1 1 1 1 0 0 0 0 0 
(4)  0 0 1 0 0 0 0 0 0 0 0 
(5)  0 0 0 0 1 0 1 1 0 1 0 
(6)  1 1 1 0 0 1 0 1 0 0 1 
(7)  0 1 0 0 1 0 0 1 0 0 0 
(8)  0 0 0 1 1 0 0 0 0 0 1 
(9)  1 0 1 0 0 1 0 1 0 1 0 
(10) 0 0 0 1 0 0 1 0 0 1 0 
    */
    const gameCount = await minesweeper.connect(signers.alice).gameCount();
    console.log(gameCount);

    const deterministic = await minesweeper.connect(signers.alice).deterministic();
    console.log(deterministic);

    // return;
    const cluePlusOne = await minesweeper.connect(signers.alice).getDebugClearCluesPlusOne(signers.alice, 30);
    console.log(cluePlusOne);

    // // // Reencrypt Alice's balance
    const encBoard = await minesweeper.boardOf(signers.alice);
    const board = await reencryptEuint256(signers.alice, fhevm, encBoard, minesweeperAddress);
    //448721464640671236880907976639495329093629697800122135872536537345310737n
    console.log(board);
    //expect(balanceAlice).to.equal(1000);
  });

  it("Test Using Simulator", async function () {
    const clearBoard = computeDeterministicBoard(BigInt(0), BigInt(0));
    console.log(clearBoard);

    const simulator = new FHEMinesweeperSimulator();
    const res = simulator._bombAndClueAt(clearBoard, 30n);

    const clues = [];
    for (let i = 0; i < ROWS * COLS; ++i) {
      const res = simulator._bombAndClueAt(clearBoard, BigInt(i));
      clues.push(res.clue);
    }

    /*
    (0)  1 0 0 0 0 0 0 0 0 0 0 
    (1)  0 0 0 0 0 1 0 0 0 0 0 
    (2)  0 0 1 0 0 0 0 0 0 0 0 
    (3)  0 0 0 0 0 0 0 0 0 0 0 
    (4)  0 0 0 1 0 1 0 0 1 0 1 
    (5)  1 0 1 1 0 0 0 0 0 1 0 
    (6)  1 0 0 0 1 0 0 0 1 1 0 
    (7)  0 0 0 1 0 1 0 0 0 0 0 
    (8)  0 0 0 0 0 1 0 0 0 1 1 
    (9)  0 0 0 0 1 0 0 0 0 0 0 
    (10) 0 0 0 0 0 0 1 0 0 0 0 
    */

    /*
(0)  9 1 0 0 1 1 1 0 0 0 0 
(1)  1 2 1 1 1 9 1 0 0 0 0 
(2)  0 1 9 1 1 1 1 0 0 0 0 
(3)  0 1 2 2 2 1 1 1 1 2 1 
(4)  1 2 3 9 3 9 1 1 9 3 9 
(5)  9 3 9 9 4 2 1 2 4 9 3 
(6)  9 3 3 4 9 2 1 1 9 9 2 
(7)  1 1 1 9 4 9 2 1 3 4 3 
(8)  0 0 1 2 4 9 2 0 1 9 9 
(9)  0 0 0 1 9 3 2 1 1 2 2 
(10) 0 0 0 1 1 2 9 1 0 0 0 
    */
    simulator.printArrayBoard(clues, true);
    simulator.printArrayBoard(clues, !true);

    // const tx0 = await minesweeper.connect(signers.alice).newGame(0);
    // await tx0.wait();

    // const tx1 = await minesweeper.connect(signers.alice).revealCell(30);
    // await tx1.wait();

    // await awaitAllDecryptionResults();

    // const deterministic = await minesweeper.connect(signers.alice).deterministic();
    // console.log("deterministic = " + deterministic);

    // const gameCount: bigint = await minesweeper.connect(signers.alice).gameCount();
    // console.log("gameCount = " + gameCount);
    //expect(gameCount).to.equal(1);

    // const clearValue: bigint = await minesweeper.connect(signers.alice).getClearCell(30);
    // console.log("clearValue[30] = " + clearValue);

    // expect(clearValue).to.equal(0);
    // expect(clearValue).to.equal(0);

    // const isGameOver = await minesweeper.isItGameOver();
    // console.log("isGameOver = " + isGameOver);
    //expect(isGameOver).to.be.false;

    //await printClearCache(false, true);

    //2658455991569831745807614120560689152
    //1329227995784915872903807060280344576
    // const res = await minesweeper.connect(signers.alice).getClearCacheRows256();
    // console.log(`res[0] = ${res[0]}`);
    // console.log(`res[1] = ${res[1]}`);
  });
});
