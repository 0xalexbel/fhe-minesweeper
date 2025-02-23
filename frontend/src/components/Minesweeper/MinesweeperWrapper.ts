import { ethers } from 'ethers';
import {
  address,
  toAddr,
  uint256,
  uint4,
  uint8,
} from '../../../../hardhat/src/sol';
import {
  MINESWEEPER_COLS,
  MINESWEEPER_ROWS,
  parseCache256x4,
  parseMoves,
} from '../../../../hardhat/src/fheminesweeper';
import { IFHEMinesweeper } from '../../../../hardhat/src/FHEMinesweeper.types';
import { FHEMinesweeperContract } from '../../../../hardhat/src/FHEMinesweeperContract';
import { FHEMinesweeperContractSimulator } from '../../../../hardhat/src/FHEMinesweeperContractSimulator';

export enum MinesweeperWrapperType {
  Mocked = 1,
  Simulator,
  Sepolia,
}

export class MinesweeperWrapper {
  private contractAddr: string | undefined;
  private playerAddr: string;
  private player: ethers.AbstractSigner | undefined;
  private browserProvider: ethers.BrowserProvider | undefined;
  private readOnlyProvider: ethers.JsonRpcProvider | undefined;

  #type: MinesweeperWrapperType = MinesweeperWrapperType.Simulator;
  #itf: IFHEMinesweeper | undefined;

  static async create(
    type: MinesweeperWrapperType,
    player: ethers.JsonRpcSigner | string,
    browserProvider?: ethers.BrowserProvider,
    readOnlyProvider?: ethers.JsonRpcProvider,
    options?: {
      gatewayIntervalMs: number;
      blockIntervalInSec: number;
    },
  ): Promise<MinesweeperWrapper> {
    const mw = new MinesweeperWrapper(
      type,
      player,
      browserProvider,
      readOnlyProvider,
    );
    await mw._init(options);
    return mw;
  }

  private constructor(
    type: MinesweeperWrapperType,
    player: ethers.JsonRpcSigner | string,
    browserProvider?: ethers.BrowserProvider,
    readOnlyProvider?: ethers.JsonRpcProvider,
  ) {
    this.#type = type;
    if (typeof player === 'string') {
      this.playerAddr = ethers.getAddress(player);
      this.player = undefined;
    } else {
      this.playerAddr = player.address;
      this.player = player;
    }
    this.browserProvider = browserProvider;
    this.readOnlyProvider = readOnlyProvider;
  }

  private async _init(options?: {
    gatewayIntervalMs: number;
    blockIntervalInSec: number;
  }) {
    switch (this.#type) {
      case MinesweeperWrapperType.Mocked: {
        this.#itf = await FHEMinesweeperContract.create(
          ethers,
          true,
          //@ts-ignore
          this.player!,
          this.browserProvider,
          this.readOnlyProvider,
        );
        break;
      }
      case MinesweeperWrapperType.Simulator: {
        this.#itf = await FHEMinesweeperContractSimulator.create(
          ethers,
          //@ts-ignore
          this.player!,
          this.browserProvider,
          this.readOnlyProvider,
          options,
        );
        break;
      }
      case MinesweeperWrapperType.Sepolia: {
        this.#itf = await FHEMinesweeperContract.create(
          ethers,
          false,
          //@ts-ignore
          this.player!,
          this.browserProvider,
          this.readOnlyProvider,
        );
        break;
      }
    }
  }

  get contractAddress() {
    return this.contractAddr;
  }

  get playerAddress() {
    return this.playerAddr;
  }

  async enableDeterministicModeIfNeeded(confirms?: number, timeout?: number) {
    if (this.#type === MinesweeperWrapperType.Sepolia) {
      return;
    }
    return this.#itf!.setDeterministicMode(true, confirms, timeout);
  }

  async setDeterministicMode(
    enable: boolean,
    confirms?: number,
    timeout?: number,
  ) {
    return this.#itf!.setDeterministicMode(enable, confirms, timeout);
  }

  async newGame(
    level: uint8,
    firstCellIndex: uint8,
    confirms?: number,
    timeout?: number,
  ) {
    return this.#itf!.newGame(level, firstCellIndex, confirms, timeout);
  }

  async newCustomGame(
    player: address,
    firstCellIndex: uint8,
    inputBoard: Uint8Array | bigint,
    inputProof: Uint8Array | undefined,
    confirms?: number,
    timeout?: number,
  ) {
    return this.#itf!.newCustomGame(
      player,
      firstCellIndex,
      inputBoard,
      inputProof,
      confirms,
      timeout,
    );
  }

  async revealCell(cellIndex: uint8, confirms?: number, timeout?: number) {
    return this.#itf!.revealCell(cellIndex, confirms, timeout);
  }

  async revealCellForceExpired(cellIndex: uint8) {
    if (this.#type !== MinesweeperWrapperType.Simulator) {
      throw new Error('Only in simulation mode');
    }

    const simulator = this.#itf as FHEMinesweeperContractSimulator;

    simulator.setNextRevealCellOptions({
      forceExpired: true,
      doNotCallGateway: true,
    });

    await this.#itf!.revealCell(cellIndex);

    simulator.setNextRevealCellOptions({
      forceExpired: false,
      doNotCallGateway: false,
    });
  }

  async wait() {
    return this.#itf!.wait();
  }

  async isClearCellAvailable(cellIndex: uint8): Promise<boolean> {
    return this.#itf!.isClearCellAvailable(cellIndex);
  }

  async getFirstCellIndex(): Promise<uint8> {
    return this.#itf!.getFirstCellIndex();
  }

  async isPlayer(player: address | string): Promise<boolean> {
    return this.#itf!.isPlayer(player);
  }

  async playerHasGameInProgress(player: address | string): Promise<boolean> {
    return this.#itf!.playerHasGameInProgress(player);
  }

  private async getMoves(): Promise<uint256> {
    return this.#itf!.getMoves();
  }

  private async getClearCache256x4(): Promise<{
    block0: uint256;
    block1: uint256;
  }> {
    return this.#itf!.getClearCache256x4();
  }

  async pendingDecryptionRequest(): Promise<{
    cellIndexPlusOne: uint8;
    expired: boolean;
    delay: uint256;
  }> {
    return this.#itf!.pendingDecryptionRequest();
  }

  public cellCount(): uint8 {
    return MINESWEEPER_ROWS * MINESWEEPER_COLS;
  }

  public size(): { rows: uint8; cols: uint8 } {
    return {
      rows: MINESWEEPER_ROWS,
      cols: MINESWEEPER_COLS,
    };
  }

  async getBoardAndMoves(): Promise<
    { rows: uint8; cols: uint8; board: bigint[]; moves: number[] } | undefined
  > {
    if (!(await this.isPlayer(this.playerAddr))) {
      return undefined;
    }
    return this._getBoardAndMoves();
  }

  private async _getBoardAndMoves(): Promise<{
    rows: uint8;
    cols: uint8;
    board: uint4[];
    moves: number[];
  }> {
    const moves: uint256 = await this.getMoves();
    const { block0, block1 } = await this.getClearCache256x4();
    return {
      rows: MINESWEEPER_ROWS,
      cols: MINESWEEPER_COLS,
      board: parseCache256x4([block0, block1], Number(this.cellCount())),
      moves: parseMoves(moves, Number(this.cellCount())),
    };
  }

  async getVictoryOrGameOver(): Promise<{
    victory: boolean;
    gameOver: boolean;
  }> {
    const victory = await this.#itf!.isItAVictory();
    const gameOver = await this.#itf!.isItGameOver();
    return {
      victory,
      gameOver,
    };
  }
}
