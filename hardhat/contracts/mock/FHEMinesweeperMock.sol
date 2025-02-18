// SPDX-License-Identifier: BSD-3-Clause-Clear

pragma solidity ^0.8.24;

import "fhevm/lib/TFHE.sol";
import { FHEMinesweeper } from "../FHEMinesweeper.sol";

import { console } from "hardhat/console.sol";

contract FHEMinesweeperMock is FHEMinesweeper {
    // uint256 _count;
    euint4 _uint4_0;
    euint4 _uint4_1;
    euint32 _uint32_0;
    euint256 _uint256_0;
    euint8 _uint8_0;
    euint8 _uint8_1;

    constructor(address initialOwner_) FHEMinesweeper(initialOwner_) {
        _setDeterministicMode(true);
    }

    // function _newGameBoard(uint8 level) internal virtual override returns (euint256 board) {
    //     // Random 0
    //     uint256 clearBoard = uint256(keccak256(abi.encode(_count, level, uint256(0))));
    //     // Random 1
    //     uint256 clearR = uint256(keccak256(abi.encode(_count, level, uint256(1))));
    //     if (level == 1) {
    //         // Random 2
    //         clearR = clearR | uint256(keccak256(abi.encode(_count, level, uint256(2))));
    //     }
    //     if (level == 2) {
    //         // Random 3
    //         clearR = clearR | uint256(keccak256(abi.encode(_count, level, uint256(3))));
    //     }
    //     clearBoard = clearBoard & clearR;
    //     clearBoard = clearBoard & ((0x5555555555555555555555555555555555555555555555555555555555555555) >> 14);
    //     _count += 1;
    //     board = TFHE.asEuint256(clearBoard);
    //     TFHE.allowThis(board);
    // }

    // function boardOf(address player) external view returns (euint256) {
    //     return _boardOf(player);
    // }

    function computeShr(uint8 r) external {
        require(r >= 0 && r < rowCount(), "Invalid row");

        euint256 board = _boardOf(msg.sender);
        require(TFHE.isInitialized(board), "Player has not started any game");

        uint8 bitIndex = _rowColToBit(r, 0);

        _uint256_0 = TFHE.shr(board, bitIndex);
    }

    function setClearCachedValue4PlusOne(uint8 key, uint8 value4) external {
        _setClearCachedValue4PlusOne(msg.sender, key, value4);
    }

    function getClearCachedValue4PlusOne(uint8 key) external view returns (uint8) {
        return _getClearCachedValue4PlusOne(msg.sender, key);
    }

    function computeSixBitsAt(uint8 row, uint8 col) external {
        euint256 board = _boardOf(msg.sender);
        require(TFHE.isInitialized(board), "Player has not started any game");

        _uint8_0 = _getSixBitsAt(board, row, col);
    }

    function bombAndClueAt(uint8 cellIndex) external {
        (euint8 bomb, euint4 clue) = _bombAndClueAt(msg.sender, _boardOf(msg.sender), cellIndex, true);
        _uint8_0 = bomb;
        _uint4_0 = clue;
    }

    function revealCellMock(uint8 cellIndex) external onlyPlayer {
        _revealCell(cellIndex);
    }

    function computeCell(uint8 row, uint8 col) external {
        _uint4_0 = _computeCellU4At(_boardOf(msg.sender), row, col);
    }

    function computeRow(uint8 r) external {
        _uint32_0 = _computeRow(_boardOf(msg.sender), r);
    }

    function uint4_0() external view returns (euint4) {
        return _uint4_0;
    }

    function uint4_1() external view returns (euint4) {
        return _uint4_1;
    }

    function uint8_0() external view returns (euint8) {
        return _uint8_0;
    }

    function uint8_1() external view returns (euint8) {
        return _uint8_1;
    }

    function uint32_0() external view returns (euint32) {
        return _uint32_0;
    }

    function uint256_0() external view returns (euint256) {
        return _uint256_0;
    }
}
