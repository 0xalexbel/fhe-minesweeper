// SPDX-License-Identifier: BSD-3-Clause-Clear

pragma solidity ^0.8.24;

import "fhevm/lib/TFHE.sol";
import { FHEMinesweeper } from "../FHEMinesweeper.sol";

//import { console } from "hardhat/console.sol";

contract FHEMinesweeperMock is FHEMinesweeper {
    // uint256 _count;
    // solhint-disable-next-line var-name-mixedcase
    euint4 _uint4_0;
    // solhint-disable-next-line var-name-mixedcase
    euint4 _uint4_1;
    // solhint-disable-next-line var-name-mixedcase
    euint32 _uint32_0;
    // solhint-disable-next-line var-name-mixedcase
    euint256 _uint256_0;
    // solhint-disable-next-line var-name-mixedcase
    euint8 _uint8_0;
    // solhint-disable-next-line var-name-mixedcase
    euint8 _uint8_1;

    constructor(address initialOwner_) FHEMinesweeper(initialOwner_) {
        _setDeterministicMode(true);
    }

    function saveClearCache256x4(uint8 key, uint8 value4) external {
        _saveClearCache256x4(msg.sender, key, value4);
    }

    function getClearCacheValue4PlusOne(uint8 key) external view returns (uint8) {
        return _getClearCacheValue4PlusOne(msg.sender, key);
    }

    function computeSixBitsAt(uint8 row, uint8 col) external {
        euint256 board = _boardOf(msg.sender);
        require(TFHE.isInitialized(board), "Player has not started any game");

        _uint8_0 = _getSixBitsAt(board, row, col);
    }

    function computeEncryptedCell(uint8 cellIndex) external {
        (euint4 eCell, euint8 eIsBomb) = _computeEncryptedCell(msg.sender, _boardOf(msg.sender), cellIndex, true);
        _uint8_0 = eIsBomb;
        _uint4_0 = eCell;
    }

    function revealCellMock(uint8 cellIndex) external onlyPlayer {
        _revealCell(msg.sender, cellIndex);
    }

    /* solhint-disable-next-line func-name-mixedcase */
    function uint4_0() external view returns (euint4) {
        return _uint4_0;
    }

    /* solhint-disable-next-line func-name-mixedcase */
    function uint4_1() external view returns (euint4) {
        return _uint4_1;
    }

    /* solhint-disable-next-line func-name-mixedcase */
    function uint8_0() external view returns (euint8) {
        return _uint8_0;
    }

    /* solhint-disable-next-line func-name-mixedcase */
    function uint8_1() external view returns (euint8) {
        return _uint8_1;
    }

    /* solhint-disable-next-line func-name-mixedcase */
    function uint32_0() external view returns (euint32) {
        return _uint32_0;
    }

    /* solhint-disable-next-line func-name-mixedcase */
    function uint256_0() external view returns (euint256) {
        return _uint256_0;
    }
}
