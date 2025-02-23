// SPDX-License-Identifier: BSD-3-Clause-Clear

pragma solidity ^0.8.24;

import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";

import { TFHE, euint256, euint8, euint4, ebool, einput } from "fhevm/lib/TFHE.sol";
import { SepoliaZamaFHEVMConfig } from "fhevm/config/ZamaFHEVMConfig.sol";
import { SepoliaZamaGatewayConfig } from "fhevm/config/ZamaGatewayConfig.sol";
import { GatewayCaller } from "fhevm/gateway/GatewayCaller.sol";
import { Gateway } from "fhevm/gateway/lib/Gateway.sol";

//import { console } from "hardhat/console.sol";

contract FHEMinesweeper is SepoliaZamaFHEVMConfig, SepoliaZamaGatewayConfig, GatewayCaller, Ownable2Step {
    /// @dev DEBUG = `true`, the contract is compiled in debug mode.
    ///      DEBUG = `false`, the contract is compiled in release mode.
    bool private constant DEBUG = true;

    uint256 private constant BOARD_MASK = (0x5555555555555555555555555555555555555555555555555555555555555555) >> 14;
    uint8 private constant ROWS = 11;
    uint8 private constant COLS = 11;
    uint8 private constant BITS_PER_CELL = 2;
    uint8 private constant CELL_MASK = 0x3;
    uint8 private constant CELL_IS_BOMB_THRESHOLD = 0x9;
    uint8 private constant YES = 0x11;
    uint8 private constant NO = 0xFF;
    uint8 private constant CUSTOM_LEVEL = 0xFF;
    uint64 private constant GATEWAY_DELAY_IN_SEC = 120;

    struct Game {
        uint256 moves;
        euint256 board;
        uint8 level;
        uint8 exploded;
        uint8 victory;
        uint8 firstCellIndex;
    }

    struct CellDecryptionRequest {
        euint4 eCell;
        ebool eVictory;
        uint256 delay;
        address player;
        uint8 cellIndexPlusOne;
    }

    /// @dev Encrypted 256 bits zero (uint256), precomputed for efficiency.
    euint256 private immutable _ZERO_EU256;
    /// @dev Encrypted 8 bits zero (uint8), precomputed for efficiency.
    euint8 private immutable _ZERO_EU8;
    /// @dev Encrypted 4 bits zero (uint4), precomputed for efficiency.
    euint4 private immutable _ZERO_EU4;

    /// @dev Total number of deterministically generated games (debug only).
    uint256 _deterministicGameCount;
    /// @dev If true, game boards are generated deterministically (debug only).
    bool _deterministic;

    /// @dev Tracks the current game associated with each player address. A player can play one game at a time.
    mapping(address player => Game) private _games;
    /// @dev Caches the cells successfully revealed and decrypted by a player in their current game.
    ///      Cells are encoded in 4-bit values, packed into 256-bit integers (64 cells per uint256).
    ///      For an 11x11 grid (121 cells), the cache uses 2 uint256 blocks.
    ///      Cell encoding:
    ///      - 0: Not decrypted
    ///      - 1: Empty (no neighboring bombs)
    ///      - 2–9: Number of neighboring bombs (1–8)
    ///      - ≥10: Bomb
    mapping(address player => mapping(uint8 blockIndex => uint256 cacheBlock256)) private _clearCache256x4;
    /// @dev DEBUG=true. Encrypted version of `_clearCache256x4`
    mapping(address player => mapping(uint8 rowIndex => euint256 cacheRow256)) private _encryptedCache256x4;
    /// @dev Tracks Gateway decryption request IDs.
    ///      Since `requestID` starts at zero, we store `requestID + 1` to distinguish an existing request
    ///      from a null (zero) value.
    mapping(uint256 requestIDPlusOne => CellDecryptionRequest) private _requestIDPlusOneToRequest;
    /// @dev Maps each player to their active decryption request ID (`requestID + 1`) to distinguish valid
    ///      requests from null values.
    mapping(address player => uint256 requestIDPlusOne) private _playerToRequestIDPlusOne;

    /// @dev DEBUG=true. Helper to identify potential bug in the `_clearCache256x4` mapping
    mapping(address player => mapping(uint8 rowIndex => uint8 clearCell)) private _debugClearCellsPlusOne;

    /// @dev Emitted when a cell revealed by `player` using `revealCell` is successfully decrypted by the Gateway.
    ///      `victory` indicates whether the player won the game with this reveal. If `cellIndex` equals 9 then
    ///      the player lost the game.
    event CellRevealed(address indexed player, uint8 indexed cellIndex, uint8 cellValue, bool victory);

    error GameOver(address sender);
    error SenderNotAPlayer(address sender);
    error CellIndexOutOfBounds(uint8 cellIndex);
    error InvalidRowCol(uint8 row, uint8 col);
    error CellNotDecrypted(uint8 cellIndex);
    error CellAlreadyDecrypted(uint8 cellIndex);
    error CellDecryptionAlreadyRequested(uint8 pendingCellIndex, uint8 newCellIndex);
    error UnknownCellDecryptionRequestID(uint256 requestID);
    error RequestIDAlreadyCompleted(uint256 requestID);

    /*
     * The following error codes are exclusively for debugging purpose.
     */
    uint8 private constant E_VALUE4_OVERFLOW = 1;
    uint8 private constant E_BLOCK_INDEX_OVERFLOW = 2;
    uint8 private constant E_CELL_VALUE_OVERFLOW = 3;
    uint8 private constant E_UNEXPECTED_DECRYPTION_REQUEST = 4;
    uint8 private constant E_CORRUPTED_REQUEST_DB = 5;
    uint8 private constant E_UNEXPECTED_MOVE_RECORD = 6;
    error DebugInternalError(uint8 code);

    /**
     * @dev Throws if the caller is not an active player.
     */
    modifier onlyPlayer() {
        if (!TFHE.isInitialized(_boardOf(msg.sender))) {
            revert SenderNotAPlayer(msg.sender);
        }
        _;
    }

    /**
     * @dev Throws if the caller has already lost its game.
     */
    modifier notGameOver() {
        if (_games[msg.sender].exploded == YES) {
            revert GameOver(msg.sender);
        }
        _;
    }

    /**
     * @dev Throws if cell index is out of bounds.
     */
    function _requireValidCellIndex(uint8 cellIndex) internal pure {
        if (cellIndex >= ROWS * COLS) {
            revert CellIndexOutOfBounds(cellIndex);
        }
    }

    /**
     * @dev Throws if `row` or `col` exceed the board limits.
     */
    function _requireValidRowCol(uint8 row, uint8 col) internal pure {
        if (row >= ROWS || col >= COLS) {
            revert InvalidRowCol(row, col);
        }
    }

    constructor(address initialOwner_) Ownable(initialOwner_) {
        _ZERO_EU256 = TFHE.asEuint256(0);
        TFHE.allowThis(_ZERO_EU256);
        _ZERO_EU8 = TFHE.asEuint8(0);
        TFHE.allowThis(_ZERO_EU8);
        _ZERO_EU4 = TFHE.asEuint4(0);
        TFHE.allowThis(_ZERO_EU4);
    }

    /**
     * @notice Returns `true` if the contract is compiled in debug mode; otherwise `false`.
     */
    function isDebug() external pure returns (bool) {
        return DEBUG;
    }

    /**
     * @notice Returns constant Gateway callback delay in seconds.
     */
    function gatewayDelayInSec() external pure returns (uint64) {
        return GATEWAY_DELAY_IN_SEC;
    }

    /**
     * @notice Returns the Minesweeper board dimensions.
     *         Board size is fixed and not customizable in the current implementation.
     */
    function size() external pure returns (uint8 rows, uint8 cols) {
        rows = ROWS;
        cols = COLS;
    }

    /**
     * @notice Returns the total number of deterministically generated games (debug only).
     */
    function deterministicGameCount() external view returns (uint256) {
        return _deterministicGameCount;
    }

    /**
     * @notice Returns `true` if future games will be deterministically generated (debug only).
     */
    function deterministic() external view returns (bool) {
        return _deterministic;
    }

    /**
     * @notice Allows the owner to enable or disable deterministic game generation mode.
     *         This flag controls whether future games will be generated deterministically (debugging only).
     */
    function setDeterministicMode(bool enable) external onlyOwner {
        _setDeterministicMode(enable);
    }

    /**
     * @dev Internal function to set the deterministic mode flag (Required by the mock contract).
     */
    function _setDeterministicMode(bool enable) internal {
        _deterministic = enable;
    }

    /**
     * @notice Returns `true` if the `player` is a registered player.
     */
    function isPlayer(address player) external view returns (bool) {
        return TFHE.isInitialized(_boardOf(player));
    }

    /**
     * @notice Returns `true` if the `player` has an active game in progress, `false` otherwise.
     */
    function playerHasGameInProgress(address player) external view returns (bool) {
        return _playerHasGameInProgress(player);
    }

    /**
     * @dev See {playerHasGameInProgress}
     */
    function _playerHasGameInProgress(address player) internal view returns (bool) {
        Game storage game = _games[player];
        if (!TFHE.isInitialized(game.board)) {
            return false;
        }
        if (game.exploded == YES) {
            return false;
        }
        if (game.victory == YES) {
            return false;
        }
        return true;
    }

    /**
     * @notice Returns the index of the first cell selected by the player to reveal at the start of the game.
     *         To prevent an instant loss, this selected cell is automatically cleared of any bombs.
     */
    function getFirstCellIndex() external view returns (uint8) {
        return _gameOf(msg.sender).firstCellIndex;
    }

    /**
     * @notice Returns a 256-bit integer representing all the cells picked by the caller so far.
     *         Each bit corresponds to a cell: if the bit is set, the cell has been revealed via `revealCell`;
     *         if the bit is not set, the cell has not been picked yet.
     *         Note that if the bit is set, it does not necessarily mean the cell has been decrypted.
     */
    function moves() external view returns (uint256) {
        return _gameOf(msg.sender).moves;
    }

    /**
     * @notice Returns `true` if the caller has won its game
     */
    function isItAVictory() external view returns (bool) {
        return _gameOf(msg.sender).victory == YES;
    }

    /**
     * @notice Returns `true` if the caller has lost its game
     */
    function isItGameOver() external view returns (bool) {
        return _gameOf(msg.sender).exploded == YES;
    }

    /**
     * @dev Clears all data related to the player's game.
     * This operation must be performed before the player can start a new game.
     */
    function _deleteGame(address player) private {
        if (TFHE.isInitialized(_games[player].board)) {
            delete _games[player];

            if (DEBUG) {
                _deleteEncryptedCache256x4(player);
            }
            _deleteClearCache256x4(player);

            if (_playerToRequestIDPlusOne[player] > 0) {
                delete _requestIDPlusOneToRequest[_playerToRequestIDPlusOne[player]];
            }
            delete _playerToRequestIDPlusOne[player];
        }
    }

    /**
     * @dev Generates a random board of 256 cells with a controlled number of `1`s based on the specified `level`.
     *      The percentage of `1`s in the board is statistically controlled as follows:
     *      - level 0: ~9% of cells will be `1`
     *      - level 1: ~14% of cells will be `1`
     *      - level 2: ~20% of cells will be `1`
     * @param level The difficulty level that determines the percentage of `1`s on the board.
     * @param startMask A bitmask used to initialize the board, ensuring a specific starting state.
     * @return board The generated random game board with the desired number of `1`s.
     */
    function _newGameBoard(uint8 level, uint256 startMask) internal virtual returns (euint256 board) {
        // Level 0: R0 & R1 & R3 & (R2 | R4)
        // Level 1: R0 & R1 & R3
        // Level 2: R0 & R1 & (R2 | R4)
        board = TFHE.and(TFHE.randEuint256(), TFHE.randEuint256());
        if (level < 2) {
            board = TFHE.and(board, TFHE.randEuint256());
        }
        if (level != 1) {
            board = TFHE.and(board, TFHE.or(TFHE.randEuint256(), TFHE.randEuint256()));
        }
        // Apply Mask
        board = TFHE.and(board, BOARD_MASK & startMask);
    }

    /**
     * @dev See {_newGameBoard}. Generates the same board but uses a deterministic random function for board generation.
     *      The randomness is predictable, making the board generation repeatable and useful for testing/debugging.
     */
    function _newGameDeterministicBoard(uint8 level, uint256 startMask) internal virtual returns (euint256 board) {
        // Level 0: R0 & R1 & R3 & (R2 | R4)
        // Level 1: R0 & R1 & R3
        // Level 2: R0 & R1 & (R2 | R4)
        uint256 clearBoard = uint256(keccak256(abi.encode(_deterministicGameCount, level, uint256(0)))) &
            uint256(keccak256(abi.encode(_deterministicGameCount, level, uint256(1))));

        if (level < 2) {
            clearBoard = clearBoard & uint256(keccak256(abi.encode(_deterministicGameCount, level, uint256(3))));
        }

        if (level != 1) {
            clearBoard =
                clearBoard &
                (uint256(keccak256(abi.encode(_deterministicGameCount, level, uint256(2)))) |
                    uint256(keccak256(abi.encode(_deterministicGameCount, level, uint256(4)))));
        }

        clearBoard = clearBoard & (BOARD_MASK & startMask);
        board = TFHE.asEuint256(clearBoard);
        _deterministicGameCount += 1;
    }

    /**
     * @dev Helper function, returns the 256-bits mask associated with the cell at `cellIndex` in a 256-bits board.
     */
    function _cellMask(uint8 cellIndex) private pure returns (uint256) {
        return ~(uint256(CELL_MASK) << (cellIndex * BITS_PER_CELL));
    }

    /**
     * @dev Helper function, returns `true` if the cell at `cellIndex` play flag is set.
     */
    function _getCellPlayFlag(Game storage game, uint8 cellIndex) private view returns (bool) {
        return uint8((game.moves >> (cellIndex * BITS_PER_CELL)) & CELL_MASK) == 1;
    }

    /**
     * @dev Helper function, sets the cell at `cellIndex` play flag.
     */
    function _setCellPlayFlag(Game storage game, uint8 cellIndex) private {
        game.moves = game.moves | (1 << (cellIndex * BITS_PER_CELL));
    }

    /**
     * @notice Sets the `player`'s game board using an encrypted board created and sent by another account.
     *         This is used for the Challenge mode, where a pre-generated board is provided for the player.
     *         Reverts if the `player` has a game in progress.
     * @param player The address of the player who will play the game.
     * @param firstCellIndex The index of the first cell to be revealed on the board.
     * @param inputHandle An fhEVM handle to the input data that contains the encrypted board.
     * @param inputProof The fhEVM proof used to verify the validity of the encrypted board.
     */
    function newCustomGame(
        address player,
        uint8 firstCellIndex,
        einput inputHandle,
        bytes calldata inputProof
    ) external {
        _requireValidCellIndex(firstCellIndex);
        require(player != msg.sender, "Player must differ from sender");

        if (_playerHasGameInProgress(player)) {
            revert("Player has a game in progress");
        }

        euint256 newBoard = TFHE.and(
            TFHE.asEuint256(inputHandle, inputProof),
            (BOARD_MASK & _cellMask(firstCellIndex))
        );

        _newGame(player, CUSTOM_LEVEL, newBoard, firstCellIndex);
    }

    /**
     * @notice Starts a new game for the caller, setting up a board based on the specified difficulty level
     *         and first cell index. The board is generated either deterministically or randomly depending
     *         on the current mode.
     * @param level The difficulty level that influences the number of `1`s on the board.
     *              - level 0: ~9% of cells will be `1`
     *              - level 1: ~14% of cells will be `1`
     *              - level 2: ~20% of cells will be `1`
     * @param firstCellIndex The index of the first cell to be revealed at the start of the game.
     *                        The index must be within the valid range of the board.
     * @dev Validates the `firstCellIndex` to ensure it's within bounds, and then creates a new game board
     *      based on the selected difficulty and mode (deterministic or random). The game is then initialized
     *      for the caller.
     */
    function newGame(uint8 level, uint8 firstCellIndex) external {
        _requireValidCellIndex(firstCellIndex);

        uint256 startMask = _cellMask(firstCellIndex);
        euint256 newBoard = _deterministic
            ? _newGameDeterministicBoard(level, startMask)
            : _newGameBoard(level, startMask);

        _newGame(msg.sender, level, newBoard, firstCellIndex);
    }

    /**
     * @dev Internal function. Updates the `player` game infos. Gives TFHE permissions to the contract
     *      as well as the contract owner.
     */
    function _newGame(address player, uint8 level, euint256 board, uint8 firstCellIndex) internal {
        TFHE.allowThis(board);
        TFHE.allow(board, owner());

        _deleteGame(player);
        _games[player] = Game({
            level: level,
            board: board,
            exploded: NO,
            moves: 0,
            victory: NO,
            firstCellIndex: firstCellIndex
        });
    }

    /**
     * @notice Allows the caller to resign from their current active game.
     * @dev Does not revert if the caller has no active game.
     */
    function resign() external {
        _deleteGame(msg.sender);
    }

    /**
     * @dev Returns a reference to the `Game` struct associated with the specified `player`.
     *      This function provides access to the player's current game data stored in the contract.
     * @param player The address of the player whose game data is being accessed.
     * @return A storage reference to the `Game` struct for the specified player.
     */
    function _gameOf(address player) internal view returns (Game storage) {
        return _games[player];
    }

    /**
     * @dev Returns the encrypted game board of the current game played by the specified `player`.
     *      The board is stored on a single 256bits integer.
     */
    function boardOf(address player) external view returns (euint256) {
        return _boardOf(player);
    }

    /**
     * @dev Internal function, @see {boardOf}
     */
    function _boardOf(address player) internal view returns (euint256) {
        return _games[player].board;
    }

    /**
     * @dev Internal function that converts a `(row, col)` coordinate into a bit position on the game board.
     * @param row The row position of the cell on the board.
     * @param col The column position of the cell on the board.
     * @return bitIndex The bit index where the cell is stored on the board, calculated based on the row and column.
     */
    function _rowColToBit(uint8 row, uint8 col) internal pure returns (uint8 bitIndex) {
        bitIndex = (row * COLS + col) * BITS_PER_CELL;
    }

    /**
     * @dev {_rowColToBit} inverse function.
     */
    function _cellToRowCol(uint8 cellIndex) internal pure returns (uint8 row, uint8 col) {
        row = cellIndex / COLS;
        col = cellIndex % COLS;
    }

    /**
     * @dev Internal function that converts a `(row, col)` coordinate into a cell index on the game board.
     * @param row The row position of the cell on the board.
     * @param col The column position of the cell on the board.
     * @return cellIndex The cell index where the cell is stored on the board, calculated based on the row and column.
     */
    function _rowColToCell(uint8 row, uint8 col) internal pure returns (uint8 cellIndex) {
        cellIndex = row * COLS + col;
    }

    /**
     * @dev Given a `(row, col)` coordinate, extracts the encrypted 6-bit chunk from the encrypted board.
     *      The 6 bits are composed as follows:
     *      - bits 0-1: The 2-bit cell at position (row, col-1)
     *      - bits 2-3: The 2-bit cell at position (row, col)
     *      - bits 4-5: The 2-bit cell at position (row, col+1)
     * @param eBoard The encrypted game board.
     * @param row The row position of the cell on the board.
     * @param col The column position of the cell on the board.
     * @return sixBits A 6-bit chunk containing the values from the three adjacent cells (left, center, right).
     */
    function _getSixBitsAt(euint256 eBoard, uint8 row, uint8 col) internal returns (euint8 sixBits) {
        if (col == 0) {
            sixBits = TFHE.and(TFHE.asEuint8(TFHE.shr(eBoard, _rowColToBit(row, 0))), uint8(0xF));
        } else {
            sixBits = TFHE.asEuint8(TFHE.shr(eBoard, _rowColToBit(row, col - 1)));
        }
    }

    /**
     * @dev Computes the cell and bomb status for the specified cell on the encrypted board.
     * @param player The address of the player requesting the computation.
     * @param eBoard The encrypted game board containing all cell states.
     * @param cellIndex The index of the cell for which the bomb count and cell are calculated.
     * @param computeIsBomb If `true` the `eIsBomb` return value is computed.
     *
     * @dev The function calculates the number of bombs surrounding the specified cell by examining a 3x3 square
     *      centered on the given `cellIndex`:
     *      - It extracts three rows (above, at, and below the cell's row) from the board, with each row
     *        being represented as an encrypted `uint8` integer.
     *      - The 3 rows are then summed to calculate the bomb count in each column.
     *      - The result is packed into 6 bits (2 bits for each of the three columns).
     *      - The total bomb count is computed by summing these bits together.
     *      - The last step consists of computing the bomb flag at `cellIndex` and the total number of surrounding
     *        bombs in the 8 adjacent cells.
     *
     * @return eCell4 A 4-bit value representing the encrypted cell content value
     *         - 0–8: Total number of surrounding bombs in the 8 adjacent cells.
     *         - >=9: Cell contains a bomb.
     * @return eIsBomb (Optional) if not 0 the cell is a bomb.
     */
    function _computeEncryptedCell(
        address player,
        euint256 eBoard,
        uint8 cellIndex,
        bool computeIsBomb
    ) internal returns (euint4 eCell4, euint8 eIsBomb) {
        _requireValidCellIndex(cellIndex);

        (uint8 row, uint8 col) = _cellToRowCol(cellIndex);

        euint8 eRowSixBits = _getSixBitsAt(eBoard, row, col);

        {
            euint8 eSum = _ZERO_EU8;
            euint8 ePrevRowSixBits = eSum;
            euint8 eNextRowSixBits = eSum;

            if (row > 0) {
                // Can be cached
                ePrevRowSixBits = _getSixBitsAt(eBoard, row - 1, col);
            }

            if (row < ROWS - 1) {
                // Can be cached
                eNextRowSixBits = _getSixBitsAt(eBoard, row + 1, col);
            }

            eSum = TFHE.add(eNextRowSixBits, TFHE.add(eRowSixBits, ePrevRowSixBits));

            euint4 eRight = TFHE.and(TFHE.asEuint4(eSum), CELL_MASK);
            euint4 eMiddle = TFHE.and(TFHE.asEuint4(TFHE.shr(eSum, uint8(2))), CELL_MASK);

            eCell4 = TFHE.add(eMiddle, eRight);
            if (col > 0 && col < COLS - 1) {
                euint4 eLeft = TFHE.and(TFHE.asEuint4(TFHE.shr(eSum, uint8(4))), CELL_MASK);
                eCell4 = TFHE.add(eCell4, eLeft);
            }
        }

        if (computeIsBomb) {
            if (col == 0) {
                // 00 or 01
                eIsBomb = TFHE.and(eRowSixBits, CELL_MASK);
            } else {
                eIsBomb = TFHE.and(TFHE.shr(eRowSixBits, BITS_PER_CELL), CELL_MASK);
            }
        }

        euint4 eRowSixBits4 = TFHE.asEuint4(eRowSixBits);

        // Bomb bit = 0 (keep bit 0 & 1)
        // Bomb bit = 2 (remove bit 0 & 1)
        euint4 eBombMask = (col == 0) ? TFHE.and(eRowSixBits4, 0x3) : TFHE.shr(eRowSixBits4, 2);

        //set bits 0
        eCell4 = TFHE.or(eCell4, eBombMask);
        //set bits 3
        eCell4 = TFHE.or(eCell4, TFHE.shl(eBombMask, 3));

        // Optional (debug only)
        if (DEBUG) {
            _saveEncryptedCache256x4(player, cellIndex, eCell4);
        }
    }

    /**
     * @dev DEBUG=true. Returns the caller's encrypted cache consisting of two 256-bit blocks.
     *      Each block contains 64 packed 4-bit values, allowing efficient storage and retrieval of small data entries.
     * @return eBlock0 The first 256-bit encrypted block with packed 4-bit values.
     * @return eBlock1 The second 256-bit encrypted block with packed 4-bit values.
     */
    function getEncryptedCache256x4() external view returns (euint256 eBlock0, euint256 eBlock1) {
        eBlock0 = _encryptedCache256x4[msg.sender][0];
        eBlock1 = _encryptedCache256x4[msg.sender][1];
    }

    /**
     * @dev DEBUG=true. Deletes the encrypted cache entry associated with the given `player`.
     * @param player The address of the player whose encrypted cache will be deleted.
     */
    function _deleteEncryptedCache256x4(address player) internal {
        _encryptedCache256x4[player][0] = euint256.wrap(0);
        _encryptedCache256x4[player][1] = euint256.wrap(0);
    }

    /**
     * @dev DEBUG=true. Saves an encrypted `(key, value4)` pair into the player's encrypted cache.
     *      The `key` determines the position of the 4-bit `value4` within the cache.
     * @param player The address of the player whose cache is being updated.
     * @param key The index (0–127) representing the position to store the 4-bit value.
     * @param eValue4 The 4-bit encrypted value to save at the specified key position.
     * @dev Contract and owner have TFHE permissions over all cache entries.
     */
    function _saveEncryptedCache256x4(address player, uint8 key, euint4 eValue4) internal {
        _requireValidCellIndex(key);

        uint8 blockIndex = key / (256 / 4);
        uint8 indexInBlock = key % (256 / 4);

        // Debug
        if (blockIndex > 1) {
            revert DebugInternalError(E_BLOCK_INDEX_OVERFLOW);
        }

        euint256 eValue256 = TFHE.shl(TFHE.asEuint256(eValue4), indexInBlock * 4);
        euint256 oldBlock = _encryptedCache256x4[player][blockIndex];

        euint256 newBlock = !TFHE.isInitialized(oldBlock) ? eValue256 : TFHE.or(oldBlock, eValue256);

        TFHE.allowThis(newBlock);
        TFHE.allow(newBlock, owner());

        _encryptedCache256x4[player][blockIndex] = newBlock;
    }

    /**
     * @dev Saves a clear `(key, value4)` pair into the player's clear cache.
     *      The `key` determines the position of the 4-bit `value4` within the cache.
     * @param player The address of the player whose cache is being updated.
     * @param key The index (0–127) representing the position to store the 4-bit value.
     * @param value4 The 4-bit clear value to save at the specified key position.
     * @dev `value4 + 1` is stored in cache to support null entries.
     */
    function _saveClearCache256x4(address player, uint8 key, uint8 value4) internal {
        _requireValidCellIndex(key);

        // Debug
        if (value4 > 0xF) {
            revert DebugInternalError(E_VALUE4_OVERFLOW);
        }

        uint8 blockIndex = key / (256 / 4);
        uint8 indexInBlock = key % (256 / 4);

        // Debug
        if (blockIndex > 1) {
            revert DebugInternalError(E_BLOCK_INDEX_OVERFLOW);
        }

        uint256 value256 = uint256((value4 + 1) & uint8(0xF)) << (indexInBlock * 4);

        _clearCache256x4[player][blockIndex] = _clearCache256x4[player][blockIndex] | value256;
    }

    /**
     * @dev Returns the caller's clear cache consisting of two 256-bit blocks.
     *      Each block contains 64 packed 4-bit values, allowing efficient storage and retrieval of small data entries.
     * @return block0 The first 256-bit clear block with packed 4-bit values.
     * @return block1 The second 256-bit clear block with packed 4-bit values.
     */
    function getClearCache256x4() external view returns (uint256 block0, uint256 block1) {
        block0 = _clearCache256x4[msg.sender][0];
        block1 = _clearCache256x4[msg.sender][1];
    }

    /**
     * @dev Deletes the clear cache entry associated with the given `player`.
     * @param player The address of the player whose encrypted cache will be deleted.
     */
    function _deleteClearCache256x4(address player) internal {
        delete _clearCache256x4[player][0];
        delete _clearCache256x4[player][1];
    }

    /**
     * @dev Retrieves the 4-bit cached value associated with the given `key` for the specified `player`.
     *      The stored value is returned as `(cachedValue + 1)` to differentiate between an uninitialized entry
     *      (returned as 0).
     * @param player The address of the player whose cache is being accessed.
     * @param key The index representing the position of the cached value (must be less than ROWS * COLS).
     * @return value4PlusOne The 4-bit cached value incremented by 1.
     */
    function _getClearCacheValue4PlusOne(address player, uint8 key) internal view returns (uint8 value4PlusOne) {
        _requireValidCellIndex(key);

        uint8 blockIndex = key / (256 / 4);
        uint8 indexInBlock = key % (256 / 4);

        // Debug
        if (blockIndex > 1) {
            revert DebugInternalError(E_BLOCK_INDEX_OVERFLOW);
        }

        value4PlusOne = uint8(_clearCache256x4[player][blockIndex] >> (indexInBlock * 4)) & uint8(0xF);
    }

    /**
     * @notice Returns `true` if the cell at `cellIndex` in the `player`'s current game board has been decrypted
     *         by the Gateway.
     * @param player The address of the player whose game board is being checked.
     * @param cellIndex The index of the cell to verify.
     * @return `true` if the cell has been decrypted; otherwise, `false`.
     */
    function isClearCellAvailable(address player, uint8 cellIndex) external view returns (bool) {
        return _getClearCacheValue4PlusOne(player, cellIndex) > 0;
    }

    /**
     * @notice Returns the decrypted value of the cell at `cellIndex` in the `player`'s current game board.
     *         Reverts if:
     *         - The caller is not an active player (no game in progress).
     *         - The player has already lost the game.
     *         - The cell has not been decrypted by the Gateway (no cached value).
     *
     * @param cellIndex The index of the cell to retrieve.
     * @return clearCell A value representing the cell content:
     *         - 0–8: Number of neighboring bombs.
     *         - 9: Cell contains a bomb.
     */
    function getClearCell(uint8 cellIndex) external view onlyPlayer notGameOver returns (uint8 clearCell) {
        uint8 cachedCellPlusOne = _getClearCacheValue4PlusOne(msg.sender, cellIndex);

        if (cachedCellPlusOne == 0) {
            revert CellNotDecrypted(cellIndex);
        }

        // Debug. Should never happen. The `notGameOver` modifier should prevent that.
        if (cachedCellPlusOne >= CELL_IS_BOMB_THRESHOLD + 1) {
            revert DebugInternalError(E_CELL_VALUE_OVERFLOW);
        }

        clearCell = cachedCellPlusOne - 1;
    }

    /**
     * @notice Returns information about the caller's current cell decryption request.
     * @return cellIndexPlusOne The requested cell index plus one.
     *         - > 0: A cell decryption request is pending (awaiting the gateway's response).
     *         - 0: No active decryption request.
     * @return expired `true` if the decryption request has expired; otherwise, `false`.
     * @return maxBlockTimestamp  The block timestamp after which the request expires.
     */
    function pendingDecryptionRequest()
        external
        view
        onlyPlayer
        returns (uint8 cellIndexPlusOne, bool expired, uint256 maxBlockTimestamp)
    {
        uint256 requestIDPlusOne = _playerToRequestIDPlusOne[msg.sender];

        if (requestIDPlusOne == 0) {
            return (0, false, 0);
        }

        CellDecryptionRequest storage req = _requestIDPlusOneToRequest[requestIDPlusOne];

        cellIndexPlusOne = req.cellIndexPlusOne;
        maxBlockTimestamp = req.delay;
        expired = block.timestamp > req.delay;
    }

    /**
     * @notice Reveals the cell at `cellIndex` in the caller's game board.
     *
     * @dev Reverts if:
     *      - The caller has no active game in progress.
     *      - The caller has already lost the game.
     *      - The `cellIndex` is out of bounds.
     *      - The cell has already been decrypted by the gateway.
     *      - The cell has already been requested for decryption and the request is still pending (not expired).
     *
     * @notice Important:
     *         If the caller previously requested a cell decryption that has since expired, a new decryption
     *         request will be sent using the **previous cell index** instead of the provided `cellIndex`.
     *         This prevents the player from canceling a prior move by selecting a different cell after the
     *         request expiration.
     *
     * @param cellIndex The index of the cell to reveal.
     */
    function revealCell(uint8 cellIndex) external onlyPlayer notGameOver {
        _requireValidCellIndex(cellIndex);

        _revealCell(msg.sender, cellIndex);
    }

    /**
     * @dev Internal function. See {revealCell}.
     */
    function _revealCell(address player, uint8 cellIndex) internal {
        Game storage game = _games[player];

        uint8 cachedCellPlusOne = _getClearCacheValue4PlusOne(player, cellIndex);

        if (cachedCellPlusOne > 0) {
            revert CellAlreadyDecrypted(cellIndex);
        }

        euint4 encryptedCell;
        ebool encryptedVictory;

        // Any running request ?
        uint256 requestIDPlusOne = _playerToRequestIDPlusOne[player];

        if (requestIDPlusOne > 0) {
            CellDecryptionRequest storage req = _requestIDPlusOneToRequest[requestIDPlusOne];

            // Debug
            if (req.cellIndexPlusOne == 0) {
                revert DebugInternalError(E_UNEXPECTED_DECRYPTION_REQUEST);
            }

            // Debug
            if (!_getCellPlayFlag(game, req.cellIndexPlusOne - 1)) {
                revert DebugInternalError(E_UNEXPECTED_MOVE_RECORD);
            }

            if (block.timestamp <= req.delay) {
                revert CellDecryptionAlreadyRequested(req.cellIndexPlusOne - 1, cellIndex);
            }

            // Re-run the pending request.
            cellIndex = req.cellIndexPlusOne - 1;
            encryptedCell = req.eCell;
            encryptedVictory = req.eVictory;

            // Clean up, and resend request.
            delete _playerToRequestIDPlusOne[player];
            delete _requestIDPlusOneToRequest[requestIDPlusOne];
        } else {
            // Debug
            if (_getCellPlayFlag(game, cellIndex)) {
                revert DebugInternalError(E_UNEXPECTED_MOVE_RECORD);
            }

            // Set the cell play flag
            //game.moves = game.moves | (1 << (cellIndex * BITS_PER_CELL));
            _setCellPlayFlag(game, cellIndex);

            // Computes the cell encrypted cell value (skip the bomb flag)
            (encryptedCell, ) = _computeEncryptedCell(player, game.board, cellIndex, false);

            // Computes the game encrypted victory flag
            encryptedVictory = TFHE.eq(TFHE.xor(game.board, game.moves), BOARD_MASK);

            TFHE.allowThis(encryptedCell);
            TFHE.allowThis(encryptedVictory);
        }

        _requestCellDecryption(player, cellIndex, encryptedCell, encryptedVictory);
    }

    /**
     * @dev Initiates a decryption request for the specified cell. The request details are stored in
     *      `_playerToRequestIDPlusOne` and `_requestIDPlusOneToRequest` mappings.
     */
    function _requestCellDecryption(address player, uint8 cellIndex, euint4 eCell4, ebool eVictory) private {
        _requireValidCellIndex(cellIndex);

        // Debug
        if (_playerToRequestIDPlusOne[player] != 0) {
            revert DebugInternalError(E_CORRUPTED_REQUEST_DB);
        }

        uint256[] memory cts = new uint256[](2);
        cts[0] = Gateway.toUint256(eCell4);
        cts[1] = Gateway.toUint256(eVictory);
        uint256 requestID = Gateway.requestDecryption(
            cts,
            this.callbackDecryptCell.selector,
            0,
            block.timestamp + GATEWAY_DELAY_IN_SEC,
            false
        );

        // console.log("===========  Gateway.requestDecryption ===============");
        // console.log("requestID  : %s", requestID);
        // console.log("eCell4     : %s", euint4.unwrap(eCell4));
        // console.log("eVictory   : %s", ebool.unwrap(eVictory));
        // console.log("delay      : %s", block.timestamp + GATEWAY_DELAY_IN_SEC);
        // console.log("==========================");

        _playerToRequestIDPlusOne[player] = requestID + 1;
        _requestIDPlusOneToRequest[requestID + 1] = CellDecryptionRequest({
            eCell: eCell4,
            eVictory: eVictory,
            delay: block.timestamp + GATEWAY_DELAY_IN_SEC,
            player: player,
            cellIndexPlusOne: cellIndex + 1
        });
    }

    /**
     * @dev fhEVM Gateway callback function.
     */
    function callbackDecryptCell(uint256 requestID, uint8 clearCell, bool clearVictory) external onlyGateway {
        CellDecryptionRequest storage req = _requestIDPlusOneToRequest[requestID + 1];

        address player = req.player;

        // newGame has been called between two decryptions
        if (player == address(0)) {
            revert UnknownCellDecryptionRequestID(requestID);
        }

        // Debug
        if (_playerToRequestIDPlusOne[player] != requestID + 1) {
            revert DebugInternalError(E_CORRUPTED_REQUEST_DB);
        }

        uint8 cellIndexPlusOne = req.cellIndexPlusOne;

        // Debug
        if (cellIndexPlusOne == 0) {
            revert DebugInternalError(E_CORRUPTED_REQUEST_DB);
        }

        delete _playerToRequestIDPlusOne[player];
        delete _requestIDPlusOneToRequest[requestID + 1];

        Game storage game = _games[player];

        // Clamp clear cell value (since we store clearCell + 1, we must avoid overflow)
        if (clearCell >= CELL_IS_BOMB_THRESHOLD) {
            game.exploded = YES;
            clearCell = CELL_IS_BOMB_THRESHOLD;
        }

        _saveClearCache256x4(player, cellIndexPlusOne - 1, clearCell);

        game.victory = (clearVictory) ? YES : NO;

        // console.log("===========  Gateway.callbackDecryptCell ===============");
        // console.log("requestID    : %s", requestID);
        // console.log("clearCell    : %s", clearCell);
        // console.log("clearVictory : %s", clearVictory);
        // console.log("exploded     : %s", game.exploded);
        // console.log("==========================");

        if (DEBUG) {
            _debugClearCellsPlusOne[player][cellIndexPlusOne - 1] = clearCell + 1;
        }

        emit CellRevealed(player, cellIndexPlusOne - 1, clearCell, clearVictory);
    }

    /**
     * @dev DEBUG=true. Helper to identify potential bug in the `_clearCache256x4` mapping
     */
    function getDebugClearCellsPlusOne(address player, uint8 cellIndex) external view returns (uint8) {
        return _debugClearCellsPlusOne[player][cellIndex];
    }
}
