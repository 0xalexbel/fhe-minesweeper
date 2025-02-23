/*eslint-disable @typescript-eslint/ban-ts-comment */
import type { ethers } from "ethers";

import type { IFHEMinesweeper } from "./FHEMinesweeper.types";
import { sleep } from "./fheminesweeper";
import type { EthersModule, address, uint8, uint256 } from "./sol";

export class FHEMinesweeperContract implements IFHEMinesweeper {
  private contractAddr: string | undefined;
  // @ts-ignore
  private playerAddr: string;
  private player: ethers.AbstractSigner | undefined;
  // @ts-ignore
  private browserProvider: ethers.BrowserProvider | undefined;
  // @ts-ignore
  private readOnlyProvider: ethers.JsonRpcProvider | undefined;

  #mocked: boolean;
  #FHEMinesweeperContract: ethers.Contract | undefined;
  #ethersModule: EthersModule;

  static async create(
    ethersModule: EthersModule,
    mocked: boolean,
    player: ethers.AbstractSigner | string,
    browserProvider?: ethers.BrowserProvider,
    readOnlyProvider?: ethers.JsonRpcProvider,
  ): Promise<FHEMinesweeperContract> {
    const mw = new FHEMinesweeperContract(ethersModule, mocked, player, browserProvider, readOnlyProvider);
    await mw._init();
    return mw;
  }

  private constructor(
    ethersModule: EthersModule,
    mocked: boolean,
    player: ethers.AbstractSigner | string,
    browserProvider?: ethers.BrowserProvider,
    readOnlyProvider?: ethers.JsonRpcProvider,
  ) {
    this.#ethersModule = ethersModule;
    this.#mocked = mocked;
    if (typeof player === "string") {
      this.playerAddr = ethersModule.getAddress(player);
      this.player = undefined;
    } else {
      this.player = player;
    }
    this.browserProvider = browserProvider;
    this.readOnlyProvider = readOnlyProvider;
  }

  private async _resolveContractAddress(): Promise<{ address: string } | undefined> {
    if (this.#mocked) {
      return await import(
        //@ts-ignore
        "@deployments/localhost/FHEMinesweeper.json"
      );
    } else {
      return await import(
        //@ts-ignore
        "@deployments/sepolia/FHEMinesweeper.json"
      );
    }
  }

  private async _init() {
    if (this.player) {
      this.playerAddr = await this.player.getAddress();
    }

    const artifact = await this._resolveContractAddress();
    if (!artifact) {
      throw new Error("Load FHEMinesweeper artifact failed.");
    }

    this.contractAddr = artifact.address;

    this.#FHEMinesweeperContract = new this.#ethersModule.Contract(
      this.contractAddr,
      [
        "function getFirstCellIndex() external view returns (uint8)",
        "function isItAVictory() external view returns (bool)",
        "function isItGameOver() external view returns (bool)",
        "function setDeterministicMode(bool enable) external",
        "function revealCell(uint8 cellIndex) external",
        "function getClearCell(uint8 cellIndex) external view returns (uint8)",
        "function isClearCellAvailable(address player, uint8 cellIndex) external view returns (bool)",
        "function getClearCache256x4() external view returns (uint256, uint256)",
        "function moves() external view returns (uint256)",
        "function isPlayer(address player) external view returns (bool)",
        "function playerHasGameInProgress(address player) external view returns (bool)",
        "function newGame(uint8 level, uint8 firstCellIndex) external",
        "function pendingDecryptionRequest() external view returns (uint8, bool, uint256)",
      ],
      this.player,
    );
  }

  async wait(): Promise<void> {
    await sleep(4000);
  }

  async getFirstCellIndex(): Promise<uint8> {
    return await this.#FHEMinesweeperContract!.getFirstCellIndex();
  }

  async isPlayer(player: address | string): Promise<boolean> {
    if (typeof player === "bigint") {
      player = this.#ethersModule.toBeHex(player);
    }
    return await this.#FHEMinesweeperContract!.isPlayer(player);
  }

  async playerHasGameInProgress(player: address | string): Promise<boolean> {
    if (typeof player === "bigint") {
      player = this.#ethersModule.toBeHex(player);
    }
    return await this.#FHEMinesweeperContract!.playerHasGameInProgress(player);
  }

  async isClearCellAvailable(cellIndex: uint8): Promise<boolean> {
    return await this.#FHEMinesweeperContract!.isClearCellAvailable(this.playerAddr, cellIndex);
  }

  async pendingDecryptionRequest(): Promise<{
    cellIndexPlusOne: uint8;
    expired: boolean;
    delay: uint256;
  }> {
    const res = await this.#FHEMinesweeperContract!.pendingDecryptionRequest();
    return {
      cellIndexPlusOne: res[0],
      expired: res[1],
      delay: res[2],
    };
  }

  async setDeterministicMode(enable: boolean, confirms?: number, timeout?: number): Promise<void> {
    const tx: ethers.ContractTransactionResponse = await this.#FHEMinesweeperContract!.setDeterministicMode(enable);

    const receipt: ethers.ContractTransactionReceipt | null = await tx.wait(confirms, timeout);

    if (receipt?.status !== 1) {
      throw new Error("setDeterministicMode failed");
    }
  }

  async isItAVictory(): Promise<boolean> {
    return await this.#FHEMinesweeperContract!.isItAVictory();
  }

  async isItGameOver(): Promise<boolean> {
    return await this.#FHEMinesweeperContract!.isItGameOver();
  }

  async newCustomGame(
    player: address,
    firstCellIndex: uint8,
    inputBoard: Uint8Array,
    inputProof: Uint8Array,
    confirms?: number,
    timeout?: number,
  ): Promise<void> {
    const tx: ethers.ContractTransactionResponse = await this.#FHEMinesweeperContract!.newCustomGame(
      player,
      firstCellIndex,
      inputBoard,
      inputProof,
    );

    const receipt: ethers.ContractTransactionReceipt | null = await tx.wait(confirms, timeout);

    if (receipt?.status !== 1) {
      throw new Error("newGame failed");
    }
  }

  async newGame(level: uint8, firstCellIndex: uint8, confirms?: number, timeout?: number): Promise<void> {
    const tx: ethers.ContractTransactionResponse = await this.#FHEMinesweeperContract!.newGame(level, firstCellIndex);

    const receipt: ethers.ContractTransactionReceipt | null = await tx.wait(confirms, timeout);

    if (receipt?.status !== 1) {
      throw new Error("newGame failed");
    }
  }

  async revealCell(cellIndex: uint8, confirms?: number, timeout?: number): Promise<void> {
    const tx: ethers.ContractTransactionResponse = await this.#FHEMinesweeperContract!.revealCell(cellIndex);

    const receipt: ethers.ContractTransactionReceipt | null = await tx.wait(confirms, timeout);

    if (receipt?.status !== 1) {
      throw new Error("revealCell failed");
    }
  }

  async getClearCache256x4(): Promise<{
    block0: uint256;
    block1: uint256;
  }> {
    const res = await this.#FHEMinesweeperContract!.getClearCache256x4();
    return {
      block0: res[0] as uint256,
      block1: res[1] as uint256,
    };
  }

  async getMoves(): Promise<uint256> {
    return this.#FHEMinesweeperContract!.moves();
  }
}
