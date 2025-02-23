import assert from "assert";

import {
  BITS_PER_CELL,
  BOARD_MASK,
  CELL_IS_BOMB_THRESHOLD,
  CUSTOM_LEVEL,
  MINESWEEPER_COLS,
  MINESWEEPER_ROWS,
  cellMask,
  computeDeterministicBoardWithMask,
} from "./fheminesweeper";
import type { uint256 } from "./sol";
import { address } from "./sol";
import { uint8 } from "./sol";
import { checkU8 } from "./sol";
import * as sol from "./sol";
import { TFHE, ebool, euint4, euint8, euint32, euint256 } from "./tfhe";

type Game = {
  moves: uint256;
  board: euint256;
  level: uint8;
  exploded: uint8;
  victory: uint8;
  firstCellIndex: uint8;
};

type CellDecryptionRequest = {
  clue: euint4;
  victory: ebool;
  delay: uint256;
  player: address;
  cellIndexPlusOne: uint8;
  completed: boolean;
};

export type NextRevealCellOptions = {
  forceExpired: boolean;
  doNotCallGateway: boolean;
};

export class FHEMinesweeperSimulator {
  _games: sol.mapping1<Game>;
  _encryptedCache256: sol.mapping2<euint256>;
  _clearCache256: sol.mapping2<bigint>;
  _requestIDPlusOneToRequest: sol.mapping1<CellDecryptionRequest>;
  _playerToRequestIDPlusOne: sol.mapping1<uint256>;

  //mapping(address player => mapping(uint8 rowIndex => uint8 clearClue)) private _debugClearCluesPlusOne;
  _debugClearCluesPlusOne: sol.mapping2<uint8>;
  _deterministicGameCount: uint256;
  _deterministic: boolean = true;

  static readonly _ZERO_U8: euint8 = TFHE.ZERO_8;
  static readonly _ZERO_U4: euint4 = TFHE.ZERO_4;

  static readonly CELL_MASK: uint8 = 3n;
  static readonly YES: uint8 = 0x11n;
  static readonly NO: uint8 = 0xffn;

  _nextRevealOptions: NextRevealCellOptions = {
    forceExpired: false,
    doNotCallGateway: false,
  };

  static readonly GatewayRequests: Array<{
    requestID: uint256;
    cellIndex: uint8;
    eClue: euint4;
    eVictory: ebool;
    delay: uint256;
  }> = [];
  static GatewayRequestsCount: uint256 = 0n;

  readonly options: { gatewayIntervalMs: number; blockIntervalInSec: bigint } = {
    gatewayIntervalMs: 0,
    blockIntervalInSec: 10n,
  };

  readonly #ethersModule: sol.EthersModule;

  constructor(ethersModule: sol.EthersModule, options: { gatewayIntervalMs: number; blockIntervalInSec: number }) {
    this.#ethersModule = ethersModule;

    if (options) {
      this.options.gatewayIntervalMs = options.gatewayIntervalMs;
      this.options.blockIntervalInSec = BigInt(options.blockIntervalInSec);
    }

    this._deterministicGameCount = 0n;
    this._debugClearCluesPlusOne = new sol.mapping2<uint8>(() => 0n);
    this._requestIDPlusOneToRequest = new sol.mapping1<CellDecryptionRequest>(() => {
      return {
        clue: TFHE.uninitialized4(),
        victory: TFHE.uninitializedBool(),
        delay: 0n,
        player: 0n,
        cellIndexPlusOne: 0n,
        completed: false,
      };
    });
    this._playerToRequestIDPlusOne = new sol.mapping1<uint256>(() => 0n);
    this._encryptedCache256 = new sol.mapping2<euint256>(() => {
      return { value: 0n, bits: 256, initialized: false };
    });
    this._clearCache256 = new sol.mapping2<bigint>(() => 0n);
    this._games = new sol.mapping1<Game>(() => {
      return {
        moves: 0n,
        board: { value: 0n, bits: 256, initialized: false },
        level: 0n,
        exploded: 0n,
        victory: 0n,
        firstCellIndex: 0n,
      };
    });
  }

  msgSender: address | undefined;
  blockTimestamp: uint256 | undefined;

  updateBlockTimestamp() {
    this.blockTimestamp = this.computeBlockTimestamp();
  }

  computeBlockTimestamp() {
    return this.options.blockIntervalInSec * (BigInt(Date.now()) / 10_000n);
  }

  setNextRevealCellOptions(options: NextRevealCellOptions) {
    this._nextRevealOptions = { ...options };
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  callMethod<K extends keyof FHEMinesweeperSimulator>(
    msgSender: string,
    methodName: K,
    ...args: FHEMinesweeperSimulator[K] extends (...args: infer P) => any ? P : never
  ) {
    try {
      this.msgSender = BigInt(msgSender);
      this.updateBlockTimestamp();

      if (typeof this[methodName] === "function") {
        /* eslint-disable @typescript-eslint/no-unsafe-function-type */
        return (this[methodName] as Function)(...args);
      } else {
        console.error(`Method ${String(methodName)} does not exist.`);
      }
    } finally {
      this.msgSender = undefined;
      this.blockTimestamp = undefined;
    }
  }

  deterministic(): boolean {
    return this._deterministic;
  }

  // IFHEMinesweeper
  async setDeterministicMode(deterministic: boolean): Promise<void> {
    this._deterministic = deterministic;
  }

  boardOf(player: address): euint256 {
    return { ...this._games.get(player).board };
  }

  movesOf(player: address): uint256 {
    return this._games.get(player).moves;
  }

  isPlayer(player: address): boolean {
    return TFHE.isInitialized(this.boardOf(player));
  }

  playerHasGameInProgress(player: address): boolean {
    if (!TFHE.isInitialized(this.boardOf(player))) {
      return false;
    }
    if (this.isItGameOverFor(player)) {
      return false;
    }
    if (this.isItAVictoryFor(player)) {
      return false;
    }
    return true;
  }

  getFirstCellIndexFor(player: address): uint8 {
    sol.solrequire(this.playerHasGameInProgress(player), "Player is not registered");
    return this._games.get(player).firstCellIndex;
  }

  rowCount(): uint8 {
    return MINESWEEPER_ROWS;
  }

  size(): { rows: uint8; cols: uint8 } {
    return {
      rows: MINESWEEPER_ROWS,
      cols: MINESWEEPER_COLS,
    };
  }

  cellCount(): uint8 {
    return MINESWEEPER_ROWS * MINESWEEPER_COLS;
  }

  isItAVictoryFor(player: address): boolean {
    return this._games.get(player).victory == FHEMinesweeperSimulator.YES;
  }

  isItGameOverFor(player: address): boolean {
    return this._games.get(player).exploded == FHEMinesweeperSimulator.YES;
  }

  _deleteGame(player: address) {
    if (TFHE.isInitialized(this._games.get(player).board)) {
      this._games.delete(player);

      this._encryptedCache256.set(player, 0n, TFHE.uninitialized256());
      this._encryptedCache256.set(player, 1n, TFHE.uninitialized256());
      this._clearCache256.delete(player, 0n);
      this._clearCache256.delete(player, 1n);
      if (this._playerToRequestIDPlusOne.get(player) > 0) {
        this._requestIDPlusOneToRequest.delete(this._playerToRequestIDPlusOne.get(player));
      }
      this._playerToRequestIDPlusOne.delete(player, false);
    }
  }

  newCustomGame(player: address, firstCellIndex: uint8, inputHandle: bigint) {
    sol.solrequire(firstCellIndex < MINESWEEPER_ROWS * MINESWEEPER_COLS, "Cell index owerflow");

    //uint256 startMask = ~(uint256(0x3) << (firstCellIndex * 2));
    const newBoard: euint256 = TFHE.and256(
      TFHE.asEuint256(inputHandle),
      TFHE.asEuint256(BOARD_MASK & cellMask(firstCellIndex)),
    );

    this._newGame(player, CUSTOM_LEVEL, newBoard, firstCellIndex);
  }

  newGame(level: uint8, firstCellIndex: uint8) {
    sol.solrequire(this._deterministic, "Should be deterministic");
    sol.solrequire(level < 3, "Invalid level");
    sol.solrequire(firstCellIndex < MINESWEEPER_ROWS * MINESWEEPER_COLS, "Cell index owerflow");

    const startMask = cellMask(firstCellIndex);
    const newBoard: euint256 = this._deterministic
      ? this._newGameDeterministicBoard(level, startMask)
      : this._newGameBoard(level, startMask);

    this._newGame(this.msgSender!, level, newBoard, firstCellIndex);
  }

  private _newGame(player: address, level: uint8, board: euint256, firstCellIndex: uint8) {
    TFHE.allowThis(board);
    //TFHE.allow(board, owner());

    this._deleteGame(player);

    this._games.set(player, {
      level,
      board,
      exploded: FHEMinesweeperSimulator.NO,
      moves: 0n,
      victory: FHEMinesweeperSimulator.NO,
      firstCellIndex,
    });
  }

  /* eslint-disable @typescript-eslint/no-unused-vars */
  private _newGameBoard(level: uint8, startMask: uint256): euint256 {
    return TFHE.uninitialized256();
  }

  private _newGameDeterministicBoard(level: uint8, startMask: uint256): euint256 {
    checkU8(level);
    const board: euint256 = TFHE.asEuint256(
      computeDeterministicBoardWithMask(this.#ethersModule, level, this._deterministicGameCount, startMask),
    );
    this._deterministicGameCount++;
    return board;
  }

  // function _bitToRowCol(uint8 bitIndex) internal pure returns (uint8 row, uint8 col) {
  //     require(bitIndex < ROWS * COLS * BITS_PER_CELL, "Bit index owerflow");
  //     row = (bitIndex / COLS) * BITS_PER_CELL;
  //     col = (bitIndex % (COLS * BITS_PER_CELL)) / BITS_PER_CELL;
  // }
  _bitToRowCol(bitIndex: uint8): { row: uint8; col: uint8 } {
    sol.checkU8(bitIndex);
    sol.solrequire(bitIndex < MINESWEEPER_ROWS * MINESWEEPER_COLS * BITS_PER_CELL, "Bit index owerflow");
    const row: uint8 = sol.checkU8((bitIndex / MINESWEEPER_COLS) * BITS_PER_CELL);
    const col: uint8 = sol.checkU8((bitIndex % (MINESWEEPER_COLS * BITS_PER_CELL)) / BITS_PER_CELL);
    return {
      row,
      col,
    };
  }

  // function _rowColToBit(uint8 row, uint8 col) internal pure returns (uint8 bitIndex) {
  //     require(row < ROWS && col < COLS, "Row/Col owerflow");
  //     bitIndex = (row * COLS + col) * BITS_PER_CELL;
  // }
  _rowColToBit(row: uint8, col: uint8): uint8 {
    sol.checkU8(row);
    sol.checkU8(col);
    sol.solrequire(row < MINESWEEPER_ROWS && col < MINESWEEPER_COLS, "Row/Col owerflow");
    const bitIndex: uint8 = sol.checkU8((row * MINESWEEPER_COLS + col) * BITS_PER_CELL);
    return bitIndex;
  }

  // function _cellToRowCol(uint8 cellIndex) internal pure returns (uint8 row, uint8 col) {
  //     require(cellIndex < ROWS * COLS, "Cell index owerflow");
  //     row = cellIndex / COLS;
  //     col = cellIndex % COLS;
  //  }
  _cellToRowCol(cellIndex: uint8): { row: uint8; col: uint8 } {
    sol.checkU8(cellIndex);
    sol.solrequire(cellIndex < MINESWEEPER_ROWS * MINESWEEPER_COLS, "Cell index owerflow");
    const row: uint8 = sol.checkU8(cellIndex / MINESWEEPER_COLS);
    const col: uint8 = sol.checkU8(cellIndex % MINESWEEPER_COLS);
    return {
      row,
      col,
    };
  }

  // function _rowColToCell(uint8 row, uint8 col) internal pure returns (uint8 cellIndex) {
  //     require(row < ROWS && col < COLS, "Row/Col owerflow");
  //     cellIndex = row * COLS + col;
  // }
  _rowColToCell(row: uint8, col: uint8): uint8 {
    sol.checkU8(row);
    sol.checkU8(col);
    sol.solrequire(row < MINESWEEPER_ROWS && col < MINESWEEPER_COLS, "Row/Col owerflow");
    const cellIndex: uint8 = sol.checkU8(row * MINESWEEPER_COLS + col);
    return cellIndex;
  }

  // function _computeRow(euint256 board, uint8 r) internal returns (euint32) {
  //     require(r >= 0 && r < rowCount(), "Invalid row");
  //     uint8 bitIndex = _rowColToBit(r, 0);
  //     return TFHE.asEuint32(TFHE.shr(board, bitIndex));
  // }
  _computeRow(board: euint256, r: uint8): euint32 {
    TFHE.is(board, 256);
    sol.checkU8(r);
    sol.solrequire(r >= 0 && r < this.rowCount(), "Invalid row");
    const bitIndex: uint8 = this._rowColToBit(r, 0n);
    return TFHE.asEuint32(TFHE.shr256(board, bitIndex));
  }

  //  function _computeCellU4At(euint256 board, uint8 row, uint8 col) internal returns (euint4) {
  //      return TFHE.asEuint4(TFHE.shr(board, _rowColToBit(row, col)));
  //  }
  _computeCellU4At(board: euint256, row: uint8, col: uint8): euint4 {
    TFHE.is(board, 256);
    sol.checkU8(row);
    sol.checkU8(col);
    return TFHE.asEuint4(TFHE.shr256(board, this._rowColToBit(row, col)));
  }

  //  function _getSixBitsAt(euint256 board, uint8 row, uint8 col) internal returns (euint8 sixBits) {
  //      if (col == 0) {
  //         // And is optional
  //         sixBits = TFHE.and(TFHE.asEuint8(TFHE.shr(board, _rowColToBit(row, 0))), uint8(0xF));
  //      } else {
  //          sixBits = TFHE.asEuint8(TFHE.shr(board, _rowColToBit(row, col - 1)));
  //      }
  //  }
  _getSixBitsAt(board: euint256, row: uint8, col: uint8): euint8 {
    TFHE.is(board, 256);
    sol.checkU8(row);
    sol.checkU8(col);
    let sixBits: euint8;
    if (col == 0n) {
      // And is optional
      sixBits = TFHE.and8(TFHE.asEuint8(TFHE.shr256(board, this._rowColToBit(row, 0n))), sol.checkU8(0xfn));
    } else {
      sixBits = TFHE.asEuint8(TFHE.shr256(board, this._rowColToBit(row, col - 1n)));
    }
    return sixBits;
  }

  computeSixBitsAt(player: address, row: uint8, col: uint8): euint8 {
    const board: euint256 = this._boardOf(player);
    sol.solrequire(TFHE.isInitialized(board), "Player has not started any game");

    return this._getSixBitsAt(board, row, col);
  }

  _computeEncryptedCell(
    player: address,
    board: euint256,
    cellIndex: uint8,
    save: boolean,
  ): { isBomb: euint8; clue: euint4 } {
    sol.checkAddr(player);
    TFHE.is(board, 256);
    sol.checkU8(cellIndex);

    let isBomb: euint8;
    let clue: euint4;

    const { row, col }: { row: uint8; col: uint8 } = this._cellToRowCol(cellIndex);
    const rowSixBits: euint8 = this._getSixBitsAt(board, row, col);
    {
      let sum: euint8 = FHEMinesweeperSimulator._ZERO_U8;
      let prevRowSixBits: euint8 = sum;
      let nextRowSixBits: euint8 = sum;
      if (row > 0) {
        // Can be cached
        prevRowSixBits = this._getSixBitsAt(board, row - 1n, col);
      }
      if (row < MINESWEEPER_ROWS - 1n) {
        // Can be cached
        nextRowSixBits = this._getSixBitsAt(board, row + 1n, col);
      }

      sum = TFHE.add8(nextRowSixBits, TFHE.add8(rowSixBits, prevRowSixBits));

      // Optimization can get rid of this line
      // Optimization cast to uint4
      //euint4 right = TFHE.and(TFHE.asEuint4(TFHE.shr(sum, uint8(0))), CELL_MASK);
      let right: euint4 = TFHE.and4(TFHE.asEuint4(sum), FHEMinesweeperSimulator.CELL_MASK);
      let middle: euint4 = TFHE.and4(TFHE.asEuint4(TFHE.shr8(sum, sol.checkU8(2n))), FHEMinesweeperSimulator.CELL_MASK);
      let left: euint4 = TFHE.and4(TFHE.asEuint4(TFHE.shr8(sum, sol.checkU8(4n))), FHEMinesweeperSimulator.CELL_MASK);

      if (col == 0n) {
        // No need to compute left
        left = middle;
        middle = right;
        right = FHEMinesweeperSimulator._ZERO_U4;
      } else if (col == MINESWEEPER_COLS - 1n) {
        // No need to compute right
        left = FHEMinesweeperSimulator._ZERO_U4;
      }

      // 0 < N <= 9
      clue = TFHE.add4(left, TFHE.add4(middle, right));
    }

    if (col == 0n) {
      // 00 or 01
      isBomb = TFHE.and8(rowSixBits, FHEMinesweeperSimulator.CELL_MASK);
    } else {
      isBomb = TFHE.and8(TFHE.shr8(rowSixBits, BITS_PER_CELL), FHEMinesweeperSimulator.CELL_MASK);
    }

    const rowSixBits4: euint4 = TFHE.asEuint4(rowSixBits);

    // Bomb bit = 0, keep bit 0 & 1
    // Bomb bit = 2 (remove bit 0 and 1)
    const bombMask: euint4 = col == 0n ? TFHE.and4(rowSixBits4, 0x3n) : TFHE.shr4(rowSixBits4, 2n);

    //set bits 0
    clue = TFHE.or4(clue, bombMask);
    //set bits 3
    clue = TFHE.or4(clue, TFHE.shl4(bombMask, 0x3n));

    if (save) {
      this._saveEncryptedCache4x256(player, cellIndex, clue);
    }

    return { isBomb, clue };
  }

  public getEncryptedCacheRows256(player: address): {
    cacheRow0: euint256;
    cacheRow1: euint256;
  } {
    const cacheRow0 = this._encryptedCache256.get(player, 0n);
    const cacheRow1 = this._encryptedCache256.get(player, 1n);
    return {
      cacheRow0,
      cacheRow1,
    };
  }

  _saveEncryptedCache4x256(player: address, key: uint8, value4: euint4) {
    sol.checkAddr(player);
    sol.checkU8(key);
    TFHE.is(value4, 4);
    sol.solrequire(key < MINESWEEPER_ROWS * MINESWEEPER_COLS, "Key out of bounds");

    const cacheRowIndex: uint8 = sol.checkU8(key / (256n / 4n));
    const cacheColIndex: uint8 = sol.checkU8(key % (256n / 4n));

    sol.solrequire(cacheRowIndex <= 1n, "Panic: error");

    const value256: euint256 = TFHE.shl256(TFHE.asEuint256(value4), cacheColIndex * 4n);

    const oldCacheRow: euint256 = this._encryptedCache256.get(player, cacheRowIndex);
    const newCacheRow: euint256 = !TFHE.isInitialized(oldCacheRow) ? value256 : TFHE.or256(oldCacheRow, value256);

    TFHE.allowThis(newCacheRow);
    TFHE.allow(newCacheRow, player);

    this._encryptedCache256.set(player, cacheRowIndex, newCacheRow);
  }

  // key is cell index
  // value4 is clue, stored as clue + 1
  _setClearCachedValue4PlusOne(player: address, key: uint8, value4: uint8) {
    sol.checkAddr(player);
    sol.checkU8(key);
    sol.checkU4(value4);
    // Debug
    sol.solrequire(key < MINESWEEPER_ROWS * MINESWEEPER_COLS, "Key out of bounds");
    // Debug
    sol.solrequire(value4 < 0xf, "Value overflow");

    const cacheRowIndex: uint8 = sol.checkU8(key / (256n / 4n));
    const cacheColIndex: uint8 = sol.checkU8(key % (256n / 4n));

    sol.solrequire(cacheRowIndex <= 1n, "Panic: error");

    const value256: uint256 = sol.checkU256((value4 + 1n) & sol.checkU8(0xfn)) << (cacheColIndex * 4n);

    this._clearCache256.set(player, cacheRowIndex, this._clearCache256.get(player, cacheRowIndex) | value256);
  }

  pendingDecryptionRequestOf(player: address): {
    cellIndexPlusOne: uint8;
    expired: boolean;
    delay: uint256;
  } {
    const requestIDPlusOne: uint256 = this._playerToRequestIDPlusOne.get(player);
    if (requestIDPlusOne == 0n) {
      return { cellIndexPlusOne: 0n, expired: false, delay: 0n };
    }

    const req = this._requestIDPlusOneToRequest.get(requestIDPlusOne);

    sol.solrequire(req.cellIndexPlusOne > 0n, "Internal Error: req.cellIndexPlusOne == 0");
    // Debug
    sol.solrequire(req.completed == false, "Panic: req.completed == true");

    return {
      cellIndexPlusOne: req.cellIndexPlusOne,
      expired: this.requestHasExpired(req),
      delay: req.delay,
    };
  }

  getClearCache256x4Of(player: address): {
    block0: uint256;
    block1: uint256;
  } {
    const block0 = this._clearCache256.get(player, 0n);
    const block1 = this._clearCache256.get(player, 1n);
    return {
      block0,
      block1,
    };
  }

  getClearCache256x4(): { block0: uint256; block1: uint256 } {
    return this.getClearCache256x4Of(this.msgSender!);
  }

  //   key= cell index
  //   return value = clue + 1
  _getClearCachedValue4PlusOne(player: address, key: uint8): uint8 {
    sol.checkAddr(player);
    sol.checkU8(key);
    sol.solrequire(key < MINESWEEPER_ROWS * MINESWEEPER_COLS, "Key out of bounds");

    const cacheRowIndex: uint8 = sol.checkU8(key / (256n / 4n));
    const cacheColIndex: uint8 = sol.checkU8(key % (256n / 4n));

    sol.solrequire(cacheRowIndex <= 1n, "Panic: error");

    return sol.checkU4(sol.uint8(this._clearCache256.get(player, cacheRowIndex) >> (cacheColIndex * 4n)) & 0xfn);
  }

  isClearCellAvailableFor(player: address, cellIndex: uint8): boolean {
    sol.checkAddr(player);
    sol.checkU8(cellIndex);
    const cachedCluePlusOne: uint8 = this._getClearCachedValue4PlusOne(player, cellIndex);
    return cachedCluePlusOne > 0;
  }

  // Debug function
  isClearCellAvailable(cellIndex: uint8): boolean {
    return this.isClearCellAvailableFor(this.msgSender!, cellIndex);
  }

  _boardOf(player: address): euint256 {
    return this._games.get(player).board;
  }

  mod_onlyPlayer() {
    sol.solrequire(TFHE.isInitialized(this._boardOf(this.msgSender!)), "Sender is not a player");
  }

  mod_notGameOver() {
    if (this._games.get(this.msgSender!).exploded == FHEMinesweeperSimulator.YES) {
      throw new sol.SolError("Game over");
    }
  }

  getClearCell(cellIndex: uint8): uint8 {
    sol.checkU8(cellIndex);
    this.mod_onlyPlayer();
    this.mod_notGameOver();

    const cachedCluePlusOne: uint8 = this._getClearCachedValue4PlusOne(this.msgSender!, cellIndex);

    sol.solrequire(cachedCluePlusOne > 0, "No cached value");

    // Debug
    sol.solrequire(
      cachedCluePlusOne < CELL_IS_BOMB_THRESHOLD + 1n,
      "Panic: cachedCluePlusOne >= CELL_IS_BOMB_THRESHOLD + 1",
    );

    return cachedCluePlusOne - 1n;
  }

  private requestHasExpired(req: { delay: uint256 }): boolean {
    //require(block.timestamp <= decryptionReq.maxTimestamp, "Too late");

    if (this.blockTimestamp !== undefined) {
      return !(this.blockTimestamp <= req.delay);
    }

    const ts = this.computeBlockTimestamp();
    return !(ts <= req.delay);
  }

  async revealCell(cellIndex: uint8): Promise<void> {
    if (this.blockTimestamp === undefined) {
      throw new sol.SolError("this.blockTimestamp === undefined");
    }

    sol.checkU8(cellIndex);
    this.mod_onlyPlayer();
    this.mod_notGameOver();

    sol.solrequire(cellIndex < MINESWEEPER_ROWS * MINESWEEPER_COLS, "Invalid cell index");

    return this._revealCell(this.msgSender!, cellIndex);
  }

  async revealCellOf(player: address, cellIndex: uint8): Promise<void> {
    return this._revealCell(player, cellIndex);
  }

  private async _revealCell(player: address, cellIndex: uint8): Promise<void> {
    sol.checkU8(cellIndex);

    if (this.blockTimestamp === undefined) {
      throw new sol.SolError("this.blockTimestamp === undefined");
    }

    const game: Game = this._games.get(player);

    const cachedCluePlusOne: uint8 = this._getClearCachedValue4PlusOne(player, cellIndex);

    if (cachedCluePlusOne > 0) {
      sol.revert("Already revealed");
    }

    let encryptedClue: euint4;
    let encryptedVictory: ebool;

    // Any running request ?
    const requestIDPlusOne: uint256 = this._playerToRequestIDPlusOne.get(player);

    if (requestIDPlusOne > 0n) {
      const req: CellDecryptionRequest = this._requestIDPlusOneToRequest.get(requestIDPlusOne);

      if (!this.requestHasExpired(req)) {
        sol.revert("Already requested");
      }

      // Expired
      // Re-run the pending request.
      cellIndex = req.cellIndexPlusOne - 1n;
      encryptedClue = req.clue;
      encryptedVictory = req.victory;

      // Clean up, and resend request.

      this._playerToRequestIDPlusOne.delete(player);
      this._requestIDPlusOneToRequest.delete(requestIDPlusOne);
    } else {
      game.moves = sol.checkU256(game.moves | (1n << (cellIndex * 2n)));

      const res = this._computeEncryptedCell(player, game.board, cellIndex, true);

      encryptedClue = res.clue;
      encryptedVictory = TFHE.eq256(TFHE.xor256(game.board, game.moves), BOARD_MASK);

      TFHE.allowThis(encryptedClue);
      TFHE.allowThis(encryptedVictory);
    }

    return this._requestCellDecryption(player, cellIndex, encryptedClue, encryptedVictory);
  }

  private _computeNewReqDelay(): uint256 {
    if (this._nextRevealOptions.forceExpired) {
      if (FHEMinesweeperSimulator.GatewayRequests.length > 0) {
        throw new Error("forceExpired not allowed");
      }
    }
    return this._nextRevealOptions.forceExpired ? this.blockTimestamp! - 100n : this.blockTimestamp! + 100n;
  }

  async _requestCellDecryption(player: address, cellIndex: uint8, eClue: euint4, eVictory: ebool): Promise<void> {
    if (this.blockTimestamp === undefined) {
      throw new sol.SolError("this.blockTimestamp === undefined");
    }

    // Debug
    sol.solrequire(
      this._playerToRequestIDPlusOne.get(player) == 0n,
      "Panic: _playerRequestID[player].cellIndexPlusOne != 0",
    );

    const requestID = FHEMinesweeperSimulator.GatewayRequestsCount;

    const delay = this._computeNewReqDelay();
    FHEMinesweeperSimulator.GatewayRequests.push({
      requestID: requestID,
      cellIndex,
      eClue: { ...eClue },
      eVictory: { ...eVictory },
      delay,
    });
    FHEMinesweeperSimulator.GatewayRequestsCount++;

    // reset options
    this._nextRevealOptions.forceExpired = false;

    const gatewayIntervalMs = this.options.gatewayIntervalMs;

    /// Gateway engine loop
    const func = () => {
      if (FHEMinesweeperSimulator.GatewayRequests.length == 0) {
        throw new sol.SolError("GatewayRequests.length == 0");
      }

      while (FHEMinesweeperSimulator.GatewayRequests.length > 0) {
        const req = FHEMinesweeperSimulator.GatewayRequests.shift()!;
        if (!req) {
          throw new sol.SolError("FHEMinesweeperSimulator.GatewayRequests.shift() === undefined");
        }

        if (this.requestHasExpired(req)) {
          console.log(
            `GATEWAY: Skip Expired Request (requestID=${req.requestID}, cellIndex=${req.cellIndex}, delay=${req.delay}).`,
          );
          continue;
        }

        this.callbackDecryptCell(req.requestID, TFHE.decryptU4(req.eClue), TFHE.decryptBool(req.eVictory));
      }
    };

    // uint256[] memory cts = new uint256[](2);
    // cts[0] = Gateway.toUint256(eClue);
    // cts[1] = Gateway.toUint256(eVictory);
    // uint256 requestID = Gateway.requestDecryption(
    //     cts,
    //     this.callbackDecryptCell.selector,
    //     0,
    //     block.timestamp + 100,
    //     false
    // );

    // Fill vars before promise. To handle 'gatewayIntervalMs==0'
    this._playerToRequestIDPlusOne.set(player, requestID + 1n);
    this._requestIDPlusOneToRequest.set(requestID + 1n, {
      clue: eClue,
      victory: eVictory,
      delay,
      player: player,
      cellIndexPlusOne: cellIndex + 1n,
      completed: false,
    });

    // In test mode
    if (this._nextRevealOptions.doNotCallGateway) {
      return;
    }

    // Should be at the end of the function.
    const gatewayPromise: Promise<void> =
      gatewayIntervalMs === 0
        ? new Promise((resolve) => {
            func();
            resolve();
          })
        : new Promise((resolve) => setTimeout(resolve, gatewayIntervalMs)).then(func);

    return gatewayPromise;
  }

  callbackDecryptCell(requestID: uint256, clearClue: uint8, clearVictory: boolean) {
    const req: CellDecryptionRequest = this._requestIDPlusOneToRequest.get(requestID + 1n);
    const player: address = req.player;

    // If new game was called between two requests
    // newGame has been called between two decryptions
    if (player == 0n) {
      sol.revert("callbackDecryptCell: Request deleted");
    }
    if (this._playerToRequestIDPlusOne.get(player) != requestID + 1n) {
      sol.revert("callbackDecryptCell: Internal error");
    }
    if (req.completed) {
      sol.revert("callbackDecryptCell:Already completed");
    }

    req.completed = true;

    const cellIndexPlusOne: uint8 = req.cellIndexPlusOne;
    this._playerToRequestIDPlusOne.delete(player);
    this._requestIDPlusOneToRequest.delete(requestID + 1n);

    const game: Game = this._games.get(player);
    // Clamp clear clue (since we store clearClue + 1, we must avoid overflow)
    if (clearClue >= CELL_IS_BOMB_THRESHOLD) {
      game.exploded = FHEMinesweeperSimulator.YES;
      clearClue = CELL_IS_BOMB_THRESHOLD;
    }

    this._setClearCachedValue4PlusOne(player, cellIndexPlusOne - 1n, clearClue);
    game.victory = clearVictory ? FHEMinesweeperSimulator.YES : FHEMinesweeperSimulator.NO;

    // console.log("===========  callbackDecryptCell ===============");
    // console.log("requestID    : " + requestID);
    // console.log("clearClue    : " + clearClue);
    // console.log("clearVictory : " + clearVictory);
    // console.log("exploded     : " + game.exploded);
    // console.log("==========================");

    // Debug
    this._debugClearCluesPlusOne.set(player, cellIndexPlusOne - 1n, clearClue + 1n);

    //emit CellRevealed(player, cellIndexPlusOne - 1, clearClue, clearVictory);
  }

  getDebugClearCluesPlusOne(player: address, cellIndex: uint8): uint8 {
    return this._debugClearCluesPlusOne.get(player, cellIndex);
  }
}
