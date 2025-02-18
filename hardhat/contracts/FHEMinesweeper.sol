// SPDX-License-Identifier: BSD-3-Clause-Clear

pragma solidity ^0.8.24;

import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";

import "fhevm/lib/TFHE.sol";
import "fhevm/config/ZamaFHEVMConfig.sol";
import "fhevm/config/ZamaGatewayConfig.sol";
import "fhevm/gateway/GatewayCaller.sol";

//import { console } from "hardhat/console.sol";

contract FHEMinesweeper is SepoliaZamaFHEVMConfig, SepoliaZamaGatewayConfig, GatewayCaller, Ownable2Step {
    uint256 private constant BOARD_MASK = (0x5555555555555555555555555555555555555555555555555555555555555555) >> 14;
    uint8 private constant ROWS = 11;
    uint8 private constant COLS = 11;
    uint8 private constant BITS_PER_CELL = 2;
    uint8 private constant CELL_MASK = 0x3;
    uint8 private constant CELL_IS_BOMB_THRESHOLD = 0x9;
    uint8 private constant YES = 0x11;
    uint8 private constant NO = 0xFF;

    // Game
    struct Game {
        uint256 moves;
        euint256 board;
        uint8 level;
        uint8 exploded;
        uint8 victory;
    }

    euint256 private immutable _ZERO_U256;
    euint8 private immutable _ZERO_U8;
    euint4 private immutable _ZERO_U4;

    uint256 _gameCount;
    // For debug purpose
    bool _deterministic;

    // Player to Games
    mapping(address player => Game) private _games;
    mapping(address player => mapping(uint8 rowIndex => euint256 cacheRow256)) private _encryptedCache256;
    mapping(address player => mapping(uint8 rowIndex => uint256 cacheRow256)) private _clearCache256;
    mapping(uint256 requestID => CellDecryptionRequest) private _requestIDPlusOneToRequest;
    mapping(address => uint256 requestIDPlusOne) private _playerToRequestIDPlusOne;

    mapping(address player => mapping(uint8 rowIndex => uint8 clearClue)) private _debugClearCluesPlusOne;

    event CellRevealed(address player, uint8 cellIndex, uint8 cellValue, bool victory);

    struct CellDecryptionRequest {
        euint4 clue;
        ebool victory;
        uint256 delay;
        address player;
        uint8 cellIndexPlusOne;
        bool completed;
    }

    modifier onlyPlayer() {
        require(TFHE.isInitialized(_boardOf(msg.sender)), "Sender is not a player");
        _;
    }

    modifier notGameOver() {
        if (_games[msg.sender].exploded == YES) {
            revert("Game over");
        }
        _;
    }

    constructor(address initialOwner_) Ownable(initialOwner_) {
        _ZERO_U256 = TFHE.asEuint256(0);
        TFHE.allowThis(_ZERO_U256);
        _ZERO_U8 = TFHE.asEuint8(0);
        TFHE.allowThis(_ZERO_U8);
        _ZERO_U4 = TFHE.asEuint4(0);
        TFHE.allowThis(_ZERO_U4);
    }

    function size() external pure returns (uint8 rows, uint8 cols) {
        rows = ROWS;
        cols = COLS;
    }

    function rowCount() public pure returns (uint8) {
        return ROWS;
    }

    function gameCount() external view returns (uint256) {
        return _gameCount;
    }

    function hasGameInProgress() external view returns (bool) {
        return TFHE.isInitialized(_boardOf(msg.sender));
    }

    function moves() external view returns (uint256) {
        return _gameOf(msg.sender).moves;
    }

    function isItAVictory() external view returns (bool) {
        return _gameOf(msg.sender).victory == YES;
    }

    function isItGameOver() external view returns (bool) {
        return _gameOf(msg.sender).exploded == YES;
    }

    function __zeroU256() internal view returns (euint256) {
        return _ZERO_U256;
    }

    function __zeroU8() internal view returns (euint8) {
        return _ZERO_U8;
    }

    function __zeroU4() internal view returns (euint4) {
        return _ZERO_U4;
    }

    function _deleteGame(address player) private {
        if (TFHE.isInitialized(_games[player].board)) {
            delete _games[player];

            _encryptedCache256[player][0] = euint256.wrap(0);
            _encryptedCache256[player][1] = euint256.wrap(0);

            delete _clearCache256[player][0];
            delete _clearCache256[player][1];

            if (_playerToRequestIDPlusOne[player] > 0) {
                delete _requestIDPlusOneToRequest[_playerToRequestIDPlusOne[player]];
            }
            delete _playerToRequestIDPlusOne[player];
        }
    }

    function _newGameBoard(uint8 level) internal virtual returns (euint256 board) {
        board = TFHE.randEuint256();
        euint256 r = TFHE.randEuint256();
        // increase density
        if (level == 1) {
            r = TFHE.or(r, TFHE.randEuint256());
        }
        if (level == 2) {
            r = TFHE.or(r, TFHE.randEuint256());
        }
        board = TFHE.and(board, r);
        board = TFHE.and(board, BOARD_MASK);
        TFHE.allowThis(board);
        TFHE.allow(board, owner());
    }

    function _newGameDeterministicBoard(uint8 level) internal virtual returns (euint256 board) {
        // Random 0
        uint256 clearBoard = uint256(keccak256(abi.encode(_gameCount, level, uint256(0))));
        // Random 1
        uint256 clearR = uint256(keccak256(abi.encode(_gameCount, level, uint256(1))));
        if (level == 1) {
            // Random 2
            clearR = clearR | uint256(keccak256(abi.encode(_gameCount, level, uint256(2))));
        }
        if (level == 2) {
            // Random 3
            clearR = clearR | uint256(keccak256(abi.encode(_gameCount, level, uint256(3))));
        }
        clearBoard = clearBoard & clearR;
        clearBoard = clearBoard & BOARD_MASK;
        board = TFHE.asEuint256(clearBoard);
        TFHE.allowThis(board);
        TFHE.allow(board, owner());
    }

    function deterministic() external view returns (bool) {
        return _deterministic;
    }

    function setDeterministicMode(bool enable) external onlyOwner {
        _setDeterministicMode(enable);
    }

    function _setDeterministicMode(bool enable) internal {
        _deterministic = enable;
    }

    function newGame(uint8 level) external {
        require(level < 3, "Invalid level");

        _deleteGame(msg.sender);

        euint256 newBoard = _deterministic ? _newGameDeterministicBoard(level) : _newGameBoard(level);

        _games[msg.sender] = Game({ level: level, board: newBoard, exploded: NO, moves: 0, victory: NO });
        _gameCount += 1;
    }

    function _gameOf(address player) internal view returns (Game memory) {
        return _games[player];
    }

    // Debug
    function boardOf(address player) external view returns (euint256) {
        return _games[player].board;
    }

    function _boardOf(address player) internal view returns (euint256) {
        return _games[player].board;
    }

    function _bitToRowCol(uint8 bitIndex) internal pure returns (uint8 row, uint8 col) {
        require(bitIndex < ROWS * COLS * BITS_PER_CELL, "Bit index owerflow");
        row = (bitIndex / COLS) * BITS_PER_CELL;
        col = (bitIndex % (COLS * BITS_PER_CELL)) / BITS_PER_CELL;
    }

    function _rowColToBit(uint8 row, uint8 col) internal pure returns (uint8 bitIndex) {
        require(row < ROWS && col < COLS, "Row/Col owerflow");
        bitIndex = (row * COLS + col) * BITS_PER_CELL;
    }

    function _cellToRowCol(uint8 cellIndex) internal pure returns (uint8 row, uint8 col) {
        require(cellIndex < ROWS * COLS, "Cell index owerflow");
        row = cellIndex / COLS;
        col = cellIndex % COLS;
    }

    function _rowColToCell(uint8 row, uint8 col) internal pure returns (uint8 cellIndex) {
        require(row < ROWS && col < COLS, "Row/Col owerflow");
        cellIndex = row * COLS + col;
    }

    // Row len = 32
    function _computeRow(euint256 board, uint8 r) internal returns (euint32) {
        require(r >= 0 && r < rowCount(), "Invalid row");
        uint8 bitIndex = _rowColToBit(r, 0);
        return TFHE.asEuint32(TFHE.shr(board, bitIndex));
    }

    function _computeCellU4At(euint256 board, uint8 row, uint8 col) internal returns (euint4) {
        return TFHE.asEuint4(TFHE.shr(board, _rowColToBit(row, col)));
    }

    function _getSixBitsAt(euint256 board, uint8 row, uint8 col) internal returns (euint8 sixBits) {
        if (col == 0) {
            // And is optional
            sixBits = TFHE.and(TFHE.asEuint8(TFHE.shr(board, _rowColToBit(row, 0))), uint8(0xF));
        } else {
            sixBits = TFHE.asEuint8(TFHE.shr(board, _rowColToBit(row, col - 1)));
        }
    }

    function _bombAndClueAt(
        address player,
        euint256 board,
        uint8 cellIndex,
        bool save
    ) internal returns (euint8 isBomb, euint4 clue) {
        (uint8 row, uint8 col) = _cellToRowCol(cellIndex);

        euint8 rowSixBits = _getSixBitsAt(board, row, col);

        {
            euint8 sum = _ZERO_U8;
            euint8 prevRowSixBits = sum;
            euint8 nextRowSixBits = sum;

            if (row > 0) {
                // Can be cached
                prevRowSixBits = _getSixBitsAt(board, row - 1, col);
            }

            if (row < ROWS - 1) {
                // Can be cached
                nextRowSixBits = _getSixBitsAt(board, row + 1, col);
            }

            sum = TFHE.add(nextRowSixBits, TFHE.add(rowSixBits, prevRowSixBits));

            // Optimization can get rid of this line
            // Optimization cast to uint4
            //euint4 right = TFHE.and(TFHE.asEuint4(TFHE.shr(sum, uint8(0))), CELL_MASK);
            euint4 right = TFHE.and(TFHE.asEuint4(sum), CELL_MASK);
            euint4 middle = TFHE.and(TFHE.asEuint4(TFHE.shr(sum, uint8(2))), CELL_MASK);
            euint4 left = TFHE.and(TFHE.asEuint4(TFHE.shr(sum, uint8(4))), CELL_MASK);

            if (col == 0) {
                // No need to compute left
                left = middle;
                middle = right;
                right = _ZERO_U4;
            } else if (col == COLS - 1) {
                // No need to compute right
                left = _ZERO_U4;
            }

            // 0 < N <= 9
            clue = TFHE.add(left, TFHE.add(middle, right));
        }

        if (col == 0) {
            // 00 or 01
            isBomb = TFHE.and(rowSixBits, CELL_MASK);
        } else {
            isBomb = TFHE.and(TFHE.shr(rowSixBits, BITS_PER_CELL), CELL_MASK);
        }

        euint4 rowSixBits4 = TFHE.asEuint4(rowSixBits);

        // Bomb bit = 0, keep bit 0 & 1
        // Bomb bit = 2 (remove bit 0 and 1)
        euint4 bombMask = (col == 0) ? TFHE.and(rowSixBits4, 0x3) : TFHE.shr(rowSixBits4, 2);

        //set bits 0
        clue = TFHE.or(clue, bombMask);
        //set bits 3
        clue = TFHE.or(clue, TFHE.shl(bombMask, 3));

        if (save) {
            _saveEncryptedCache4x256(player, cellIndex, clue);
        }
    }

    function getEncryptedCacheRows256() external view returns (euint256 cacheRow0, euint256 cacheRow1) {
        cacheRow0 = _encryptedCache256[msg.sender][0];
        cacheRow1 = _encryptedCache256[msg.sender][1];
    }

    function _saveEncryptedCache4x256(address player, uint8 key, euint4 value4) internal {
        require(key < ROWS * COLS, "Key out of bounds");

        uint8 cacheRowIndex = key / (256 / 4);
        uint8 cacheColIndex = key % (256 / 4);

        require(cacheRowIndex <= 1, "Panic: error");

        euint256 value256 = TFHE.shl(TFHE.asEuint256(value4), cacheColIndex * 4);
        euint256 oldCacheRow = _encryptedCache256[player][cacheRowIndex];

        euint256 newCacheRow = !TFHE.isInitialized(oldCacheRow) ? value256 : TFHE.or(oldCacheRow, value256);

        TFHE.allowThis(newCacheRow);
        TFHE.allow(newCacheRow, player);

        _encryptedCache256[player][cacheRowIndex] = newCacheRow;
    }

    // key is cell index
    // value4 is clue, stored as clue + 1
    function _setClearCachedValue4PlusOne(address player, uint8 key, uint8 value4) internal {
        // Debug
        require(key < ROWS * COLS, "Key out of bounds");
        // Debug
        require(value4 < 0xF, "Value overflow");

        uint8 cacheRowIndex = key / (256 / 4);
        uint8 cacheColIndex = key % (256 / 4);

        // Debug
        require(cacheRowIndex <= 1, "Panic: error");

        uint256 value256 = uint256((value4 + 1) & uint8(0xF)) << (cacheColIndex * 4);

        _clearCache256[player][cacheRowIndex] = _clearCache256[player][cacheRowIndex] | value256;
    }

    function getClearCacheRows256() external view returns (uint256 cacheRow0, uint256 cacheRow1) {
        cacheRow0 = _clearCache256[msg.sender][0];
        cacheRow1 = _clearCache256[msg.sender][1];
    }

    // key= cell index
    // return value = clue + 1
    function _getClearCachedValue4PlusOne(address player, uint8 key) internal view returns (uint8) {
        require(key < ROWS * COLS, "Key out of bounds");

        uint8 cacheRowIndex = key / (256 / 4);
        uint8 cacheColIndex = key % (256 / 4);

        // Debug
        require(cacheRowIndex <= 1, "Panic: error");

        return uint8(_clearCache256[player][cacheRowIndex] >> (cacheColIndex * 4)) & uint8(0xF);
    }

    // Debug function
    function isClearCellAvailable(address player, uint8 cellIndex) external view returns (bool) {
        uint8 cachedCluePlusOne = _getClearCachedValue4PlusOne(player, cellIndex);
        return (cachedCluePlusOne > 0);
    }

    function getClearCell(uint8 cellIndex) external view onlyPlayer notGameOver returns (uint8) {
        uint8 cachedCluePlusOne = _getClearCachedValue4PlusOne(msg.sender, cellIndex);
        require(cachedCluePlusOne > 0, "No cached value");

        // Debug
        require(
            cachedCluePlusOne < CELL_IS_BOMB_THRESHOLD + 1,
            "Panic: cachedCluePlusOne >= CELL_IS_BOMB_THRESHOLD + 1"
        );

        return cachedCluePlusOne - 1;
    }

    function revealCell(uint8 cellIndex) external onlyPlayer notGameOver {
        require(cellIndex < ROWS * COLS, "Invalid cell index");

        _revealCell(cellIndex);
    }

    function _revealCell(uint8 cellIndex) internal {
        Game storage game = _games[msg.sender];

        uint8 cachedCluePlusOne = _getClearCachedValue4PlusOne(msg.sender, cellIndex);

        if (cachedCluePlusOne > 0) {
            revert("Already revealed");
        }

        euint4 encryptedClue;
        ebool encryptedVictory;

        // Any running request ?
        uint256 requestIDPlusOne = _playerToRequestIDPlusOne[msg.sender];
        if (requestIDPlusOne > 0) {
            CellDecryptionRequest storage req = _requestIDPlusOneToRequest[requestIDPlusOne];
            if (req.delay >= block.timestamp) {
                revert("Already requested");
            }

            // Re-run the pending request.
            cellIndex = req.cellIndexPlusOne - 1;
            encryptedClue = req.clue;
            encryptedVictory = req.victory;

            // Clean up, and resend request.
            delete _playerToRequestIDPlusOne[msg.sender];
            delete _requestIDPlusOneToRequest[requestIDPlusOne];
        } else {
            game.moves = game.moves | (1 << (cellIndex * 2));

            (, encryptedClue) = _bombAndClueAt(msg.sender, game.board, cellIndex, true);

            encryptedVictory = TFHE.eq(TFHE.xor(game.board, game.moves), BOARD_MASK);

            TFHE.allowThis(encryptedClue);
            TFHE.allowThis(encryptedVictory);
        }

        _requestCellDecryption(msg.sender, cellIndex, encryptedClue, encryptedVictory);
    }

    function _requestCellDecryption(address player, uint8 cellIndex, euint4 eClue, ebool eVictory) private {
        // Debug
        require(_playerToRequestIDPlusOne[player] == 0, "Panic: _playerRequestID[player].cellIndexPlusOne != 0");

        uint256[] memory cts = new uint256[](2);
        cts[0] = Gateway.toUint256(eClue);
        cts[1] = Gateway.toUint256(eVictory);
        uint256 requestID = Gateway.requestDecryption(
            cts,
            this.callbackDecryptCell.selector,
            0,
            block.timestamp + 100,
            false
        );

        _playerToRequestIDPlusOne[player] = requestID + 1;
        _requestIDPlusOneToRequest[requestID + 1] = CellDecryptionRequest({
            clue: eClue,
            victory: eVictory,
            delay: block.timestamp + 100,
            player: player,
            cellIndexPlusOne: cellIndex + 1,
            completed: false
        });
    }

    function callbackDecryptCell(uint256 requestID, uint8 clearClue, bool clearVictory) external onlyGateway {
        CellDecryptionRequest storage req = _requestIDPlusOneToRequest[requestID + 1];

        address player = req.player;

        // If new game was called between two requests
        // newGame has been called between two decryptions
        if (player == address(0)) {
            revert("Request deleted");
        }

        if (_playerToRequestIDPlusOne[player] != requestID + 1) {
            revert("Internal error");
        }

        if (req.completed) {
            revert("Already completed");
        }

        req.completed = true;

        uint8 cellIndexPlusOne = req.cellIndexPlusOne;

        delete _playerToRequestIDPlusOne[player];
        delete _requestIDPlusOneToRequest[requestID + 1];

        Game storage game = _games[player];

        // Clamp clear clue (since we store clearClue + 1, we must avoid overflow)
        if (clearClue >= CELL_IS_BOMB_THRESHOLD) {
            game.exploded = YES;
            clearClue = CELL_IS_BOMB_THRESHOLD;
        }

        _setClearCachedValue4PlusOne(player, cellIndexPlusOne - 1, clearClue);

        game.victory = (clearVictory) ? YES : NO;

        // console.log("===========  callbackDecryptCell ===============");
        // console.log("requestID    : %s", requestID);
        // console.log("clearClue    : %s", clearClue);
        // console.log("clearVictory : %s", clearVictory);
        // console.log("exploded     : %s", game.exploded);
        // console.log("==========================");

        // Debug
        _debugClearCluesPlusOne[player][cellIndexPlusOne - 1] = clearClue + 1;

        emit CellRevealed(player, cellIndexPlusOne - 1, clearClue, clearVictory);
    }

    function getDebugClearCluesPlusOne(address player, uint8 cellIndex) external view returns (uint8) {
        return _debugClearCluesPlusOne[player][cellIndex];
    }
}
