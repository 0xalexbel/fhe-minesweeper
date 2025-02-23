import type { ethers } from "ethers";

import type { IFHEMinesweeper } from "./FHEMinesweeper.types";
import { FHEMinesweeperSimulator, NextRevealCellOptions } from "./simulator";
import { type EthersModule, type address, toAddr, type uint8, type uint256 } from "./sol";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FHEMinesweeperContractSimulator implements IFHEMinesweeper {
  private playerSolAddr: address;
  private playerAddr: string;
  private player: ethers.JsonRpcSigner | undefined;
  private browserProvider: ethers.BrowserProvider | undefined;
  private readOnlyProvider: ethers.JsonRpcProvider | undefined;

  /* eslint-disable no-unused-private-class-members */
  #ethersModule: EthersModule;
  #simulator: FHEMinesweeperSimulator | undefined;

  static readonly GATEWAY_INTERVAL_MS: number = 1000;
  static readonly BLOCK_INTERVAL_S: number = 10;

  static async create(
    ethersModule: EthersModule,
    player: ethers.JsonRpcSigner | string,
    browserProvider?: ethers.BrowserProvider,
    readOnlyProvider?: ethers.JsonRpcProvider,
    options?: {
      gatewayIntervalMs: number;
      blockIntervalInSec: number;
    },
  ): Promise<FHEMinesweeperContractSimulator> {
    const mw = new FHEMinesweeperContractSimulator(ethersModule, player, browserProvider, readOnlyProvider, options);
    return mw;
  }

  private constructor(
    ethersModule: EthersModule,
    player: ethers.JsonRpcSigner | string,
    browserProvider?: ethers.BrowserProvider,
    readOnlyProvider?: ethers.JsonRpcProvider,
    options?: {
      gatewayIntervalMs: number;
      blockIntervalInSec: number;
    },
  ) {
    this.#ethersModule = ethersModule;
    if (typeof player === "string") {
      this.playerAddr = ethersModule.getAddress(player);
      this.player = undefined;
    } else {
      this.playerAddr = player.address;
      this.player = player;
    }
    this.browserProvider = browserProvider;
    this.readOnlyProvider = readOnlyProvider;
    this.playerSolAddr = toAddr(ethersModule, this.playerAddr);
    this.#simulator = new FHEMinesweeperSimulator(
      ethersModule,
      options ?? {
        gatewayIntervalMs: FHEMinesweeperContractSimulator.GATEWAY_INTERVAL_MS,
        blockIntervalInSec: FHEMinesweeperContractSimulator.BLOCK_INTERVAL_S,
      },
    );
  }

  setNextRevealCellOptions(options: NextRevealCellOptions) {
    this.#simulator!.setNextRevealCellOptions(options);
  }

  async isItAVictory(): Promise<boolean> {
    return this.#simulator!.isItAVictoryFor(this.playerSolAddr);
  }

  async isItGameOver(): Promise<boolean> {
    return this.#simulator!.isItGameOverFor(this.playerSolAddr);
  }

  async getFirstCellIndex(): Promise<uint8> {
    return this.#simulator!.getFirstCellIndexFor(this.playerSolAddr);
  }

  async getMoves(): Promise<uint256> {
    return this.#simulator!.movesOf(this.playerSolAddr);
  }

  async getClearCache256x4(): Promise<{
    block0: uint256;
    block1: uint256;
  }> {
    return this.#simulator!.getClearCache256x4Of(this.playerSolAddr);
  }

  async pendingDecryptionRequest(): Promise<{
    cellIndexPlusOne: uint8;
    expired: boolean;
    delay: uint256;
  }> {
    return this.#simulator!.pendingDecryptionRequestOf(this.playerSolAddr);
  }

  async isClearCellAvailable(cellIndex: uint8): Promise<boolean> {
    return this.#simulator!.callMethod(this.playerAddr, "isClearCellAvailable", cellIndex);
  }

  async isPlayer(player: address | string): Promise<boolean> {
    if (typeof player === "string") {
      player = toAddr(this.#ethersModule, player);
    }
    return this.#simulator!.isPlayer(player);
  }

  async playerHasGameInProgress(player: address | string): Promise<boolean> {
    if (typeof player === "string") {
      player = toAddr(this.#ethersModule, player);
    }
    return this.#simulator!.playerHasGameInProgress(player);
  }

  async wait(): Promise<void> {
    await sleep(500);
  }

  async setDeterministicMode(enable: boolean): Promise<void> {
    this.#simulator!.setDeterministicMode(enable);
  }

  async newGame(level: uint8, firstCellIndex: uint8): Promise<void> {
    await this.#simulator!.callMethod(this.playerAddr, "newGame", level, firstCellIndex);
  }

  /* eslint-disable @typescript-eslint/no-unused-vars */
  async newCustomGame(
    player: address,
    firstCellIndex: uint8,
    inputBoard: Uint8Array | bigint,
    inputProof: Uint8Array | undefined,
  ): Promise<void> {
    if (typeof inputBoard !== "bigint") {
      throw new Error("Expecting bigint");
    }

    await this.#simulator!.callMethod(this.playerAddr, "newCustomGame", player, firstCellIndex, inputBoard);
  }

  async revealCell(cellIndex: uint8): Promise<void> {
    await this.#simulator!.callMethod(this.playerAddr, "revealCell", cellIndex);
  }
}
