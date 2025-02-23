import type { address, uint8, uint256 } from "./sol";

export interface IFHEMinesweeper {
  wait(): Promise<void>;
  setDeterministicMode(enable: boolean, confirms?: number, timeout?: number): Promise<void>;
  newCustomGame(
    player: address,
    firstCellIndex: uint8,
    inputBoard: Uint8Array | bigint,
    inputProof: Uint8Array | undefined,
    confirms?: number,
    timeout?: number,
  ): Promise<void>;
  newGame(level: uint8, firstCellIndex: uint8, confirms?: number, timeout?: number): Promise<void>;
  revealCell(cellIndex: uint8, confirms?: number, timeout?: number): Promise<void>;
  isClearCellAvailable(cellIndex: uint8): Promise<boolean>;
  isPlayer(player: address | string): Promise<boolean>;
  playerHasGameInProgress(player: address | string): Promise<boolean>;
  getFirstCellIndex(): Promise<uint8>;
  isItAVictory(): Promise<boolean>;
  isItGameOver(): Promise<boolean>;
  getMoves(): Promise<uint256>;
  getClearCache256x4(): Promise<{
    block0: uint256;
    block1: uint256;
  }>;
  pendingDecryptionRequest(): Promise<{
    cellIndexPlusOne: uint8;
    expired: boolean;
    delay: uint256;
  }>;
}
