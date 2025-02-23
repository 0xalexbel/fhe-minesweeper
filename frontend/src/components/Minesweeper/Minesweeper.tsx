import { ethers } from 'ethers';
import { useState, useEffect, useCallback } from 'react';

import './Minesweeper.css';

import {
  MinesweeperWrapper,
  MinesweeperWrapperType,
} from './MinesweeperWrapper';
import { Button } from './Button';
import { Cell, CellProps } from './Cell';
import type { uint4, uint8 } from '../../../../hardhat/src/sol';
import { MinesweeperStatus } from './Minesweeper.types';
import {
  MINESWEEPER_COLS,
  MINESWEEPER_ROWS,
} from '../../../../hardhat/src/fheminesweeper';

export type MinesweeperProps = {
  account: string;
  provider: ethers.BrowserProvider;
  readOnlyProvider: ethers.JsonRpcProvider;
};

export const Minesweeper = ({
  //@ts-ignore
  account,
  provider,
  readOnlyProvider,
}: MinesweeperProps) => {
  const [minesweeperWrapper, setMinesweeperWrapper] = useState<
    MinesweeperWrapper | undefined
  >(undefined);
  const [waiting, setWaiting] = useState<boolean>(true);
  const [selectedCellIndex, setSelectedCellIndex] = useState<
    number | undefined
  >(undefined);
  const [status, setStatus] = useState<MinesweeperStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | undefined>(
    undefined,
  );
  const [tinyMessage, setTinyMessage] = useState<string | undefined>(undefined);
  const [buttonVisible, setButtonVisible] = useState<boolean>(true);
  const [grid, setGrid] = useState<{
    rows: number;
    cols: number;
    revealed: number;
    cells: Array<CellProps>;
  }>({
    rows: Number(MINESWEEPER_ROWS),
    cols: Number(MINESWEEPER_COLS),
    revealed: 0,
    cells: [...Array(Number(MINESWEEPER_ROWS * MINESWEEPER_COLS))].map(
      (_, i) => {
        return { id: i };
      },
    ),
  }); // Grid size (rows & columns)

  useEffect(() => {
    const loadData = async () => {
      setLoadingStatus();

      try {
        const signer = await provider.getSigner();

        const type = import.meta.env.SIMULATOR
          ? MinesweeperWrapperType.Simulator
          : !import.meta.env.MOCKED
            ? MinesweeperWrapperType.Sepolia
            : MinesweeperWrapperType.Mocked;

        const wrapper: MinesweeperWrapper = await MinesweeperWrapper.create(
          type,
          signer,
          provider,
          readOnlyProvider,
          {
            gatewayIntervalMs: 1000,
            blockIntervalInSec: 10,
          },
        );

        // //////////// TEST LOADING WITH AN EXISTING BOARD
        // if (type === MinesweeperWrapperType.Simulator) {
        //   await wrapper.newGame(0n);
        //   const p = wrapper.revealCellForceExpired(1n);
        //   await p;
        //   const { cellIndexPlusOne, expired } =
        //     await wrapper.requestedCellIndex();
        //   assert(cellIndexPlusOne === 2n);
        //   assert(expired);
        // }
        // //////////// END TEST

        setMinesweeperWrapper(wrapper);

        const boardAndMoves = await wrapper.getBoardAndMoves();
        resetGrid(boardAndMoves);

        if (!boardAndMoves) {
          setNewGameStatus();
        } else {
          setPlayingStatus(true, undefined, 'Loading the current game...');

          // Any pending request ?
          const { cellIndexPlusOne, expired } =
            await wrapper.pendingDecryptionRequest();

          if (cellIndexPlusOne > 0) {
            if (expired) {
              await commandRevealCell(Number(cellIndexPlusOne - 1n), wrapper);
            } else {
              await commandWaitForCell(Number(cellIndexPlusOne - 1n), wrapper);
            }
          } else {
            // Check that the first cell index is revealed!
            const firstCellIndex = await wrapper.getFirstCellIndex();
            if (boardAndMoves.moves[Number(firstCellIndex)] === 0) {
              await commandRevealCell(Number(firstCellIndex), wrapper);
            } else {
              setPlayingStatus(
                false,
                undefined,
                'Minesweeper is ready. You can now resume your current game.',
              );
            }
          }
        }
      } catch (error) {
        setErrorStatus('Something went wrong', (error as Error).message);
        throw error;
      }
    };

    loadData();
  }, []);

  function resetGrid(defautGrid?: {
    rows: uint8;
    cols: uint8;
    board: uint4[];
    moves: number[];
  }) {
    const rows = Number(defautGrid?.rows ?? MINESWEEPER_ROWS);
    const cols = Number(defautGrid?.cols ?? MINESWEEPER_COLS);

    const newCells: CellProps[] = [];

    let revealed = 0;
    for (let i = 0; i < rows * cols; ++i) {
      if (defautGrid) {
        if (defautGrid.board[i] !== 0n) {
          revealed++;
        }
        newCells.push({
          id: i,
          number: Number(defautGrid.board[i]),
        });
      } else {
        newCells.push({
          id: i,
        });
      }
    }
    setGrid({ rows, cols, revealed, cells: newCells });
  }

  function setLoadingStatus() {
    setStatus('loading');
    setSelectedCellIndex(undefined);
    setWaiting(true);
    setErrorMessage(undefined);
    setTinyMessage('Loading Minesweeper...');
    setButtonVisible(true);
  }

  function setNewGameStatus() {
    setStatus('new-game');
    setSelectedCellIndex(undefined);
    setWaiting(false);
    setErrorMessage(undefined);
    setTinyMessage(
      "Minesweeper is ready. Click the 'Start New Game' button to start a new game.",
    );
    setButtonVisible(true);
  }

  function setErrorStatus(msg: string, tinyMsg: string) {
    setStatus('error');
    setSelectedCellIndex(undefined);
    setWaiting(false);
    setErrorMessage(msg);
    setTinyMessage(tinyMsg);
    setButtonVisible(true);
  }

  function setVictoryStatus() {
    setStatus('victory');
    setSelectedCellIndex(undefined);
    setWaiting(false);
    setErrorMessage(undefined);
    setTinyMessage(undefined);
    setButtonVisible(true);
  }

  function setGameOverStatus() {
    setStatus('game-over');
    setSelectedCellIndex(undefined);
    setWaiting(false);
    setErrorMessage(undefined);
    setTinyMessage(undefined);
    setButtonVisible(true);
  }

  function setPlayingStatus(
    waiting: boolean,
    cellIndex?: number,
    tinyMessage?: string,
  ) {
    setStatus('playing-game');
    setSelectedCellIndex(cellIndex);
    setWaiting(waiting);
    setErrorMessage(undefined);
    setTinyMessage(tinyMessage);
    setButtonVisible(true);
  }

  async function commandStartNewGame(
    firstCellIndex: number,
    wrapper: MinesweeperWrapper,
  ) {
    setStatus('starting-game');
    setSelectedCellIndex(undefined);
    setWaiting(true);
    setErrorMessage(undefined);
    setTinyMessage('Starting new game, please wait...');
    setButtonVisible(true);
    resetGrid();

    try {
      // Activate the deterministic mode in Mocked or Simulator mode.
      await wrapper.enableDeterministicModeIfNeeded();
      await wrapper.newGame(0n, BigInt(firstCellIndex));
      const ok = await wrapper.playerHasGameInProgress(wrapper.playerAddress);
      if (!ok) {
        throw new Error('playerHasGameInProgress() returned false');
      }
      const fci = await wrapper.getFirstCellIndex();
      if (fci !== BigInt(firstCellIndex)) {
        throw new Error('getFirstCellIndex() returned an unexpected value');
      }

      await commandRevealCell(firstCellIndex, wrapper);
    } catch (error) {
      setErrorStatus('Start New Game Failed!', (error as Error).message);
    }
  }

  async function commandRevealCell(
    cellIndex: number,
    wrapper: MinesweeperWrapper,
  ) {
    setPlayingStatus(
      true,
      cellIndex,
      `Call 'revealCell(${cellIndex})'. Please wait...`,
    );

    try {
      const cellIndexBN = BigInt(cellIndex);
      await wrapper.revealCell(cellIndexBN, 1);
    } catch (error) {
      setErrorStatus(
        `Reveal Cell #${cellIndex} Failed!`,
        (error as Error).message,
      );
      throw error;
    }

    await commandWaitForCell(cellIndex, wrapper);
  }

  async function commandWaitForCell(
    cellIndex: number,
    wrapper: MinesweeperWrapper,
  ) {
    setPlayingStatus(
      true,
      cellIndex,
      `Decrypted cell value is not yet available on-chain (0%)`,
    );

    const cellIndexBN = BigInt(cellIndex);

    // Wait for the cell decryption
    for (let i = 0; i < 100; ++i) {
      const ok = await wrapper.isClearCellAvailable(cellIndexBN);
      if (ok) {
        setTinyMessage('Decrypted cell is now available on-chain.');
        break;
      }
      setTinyMessage(
        `Decrypted cell value is not yet available on-chain (${i + 1}%)`,
      );

      if (i == 99) {
        throw new Error('Time out. The cell has not been decrypted.');
      }

      await wrapper.wait();
    }

    const boardAndMoves = await wrapper.getBoardAndMoves();
    resetGrid(boardAndMoves);

    const { victory, gameOver } = await wrapper.getVictoryOrGameOver();

    if (victory) {
      setVictoryStatus();
    } else if (gameOver) {
      setGameOverStatus();
    } else {
      setPlayingStatus(false);
    }
  }

  const handleButtonClick = useCallback(() => {
    switch (status) {
      case 'new-game':
      case 'game-over':
      case 'victory': {
        commandStartNewGame(5 * 11 + 5, minesweeperWrapper!);
        break;
      }
      default: {
        throw new Error('handleButtonClick not allowed');
      }
    }
  }, [status, minesweeperWrapper]);

  const handleCellClicked = useCallback(
    //@ts-ignore
    (id: number, selected: boolean, waiting: boolean) => {
      if (!selected) {
        setSelectedCellIndex(id);
      } else {
        // Debug
        if (status !== 'playing-game') {
          throw new Error("commandRevealCell: status !== 'playing-game'");
        }
        commandRevealCell(id, minesweeperWrapper!);
      }
    },
    [status, minesweeperWrapper],
  );

  const rootCN =
    'flex flex-col items-center bg-[#ffd209] max-w-screen-md w-full';
  const titleWrapperCN =
    'flex h-full w-full justify-center gap-4 border-solid bg-[#ffd209] p-10 align-middle text-5xl font-bold tracking-tight text-black';
  const gridAndButtonWrapperCN =
    'flex w-full flex-col items-center gap-4 bg-black p-4 pt-20 rounded-xl';
  const gridCN =
    'grid w-full max-w-screen-md rounded bg-[#313131] p-2 aspect-1 cursor-default';

  return (
    <div className={rootCN}>
      <div className={titleWrapperCN}>
        <span
          className="content-center"
          style={{ fontWeight: '700', fontStretch: '75%', fontSize: '1em' }}
        >
          fhEVM Minesweeper
        </span>
        <div
          className="logo"
          style={{
            width: '100px',
            height: '100px',
          }}
        ></div>
      </div>
      <div className={gridAndButtonWrapperCN}>
        {/* Dynamic Grid */}
        <div
          className={gridCN}
          style={{
            gridTemplateColumns: `repeat(${grid.cols}, 1fr)`,
            gridTemplateRows: `repeat(${grid.rows}, 1fr)`,
            position: 'relative',
          }}
        >
          {grid.cells.map((cell) => (
            <Cell
              key={cell.id}
              id={cell.id}
              number={cell.number}
              selected={cell.id === selectedCellIndex}
              waiting={waiting}
              enabled={
                status === 'playing-game' ||
                status === 'game-over' ||
                status === 'victory'
              }
              onClick={
                waiting || status === 'game-over' || status === 'victory'
                  ? undefined
                  : handleCellClicked
              }
            />
          ))}
          {status === 'game-over' && (
            <div
              id="overlay"
              style={{
                position: 'absolute',
                width: '100%',
                height: '100%',
                backgroundColor: 'rgba(0,0,0,0.75)',
                display: 'grid',
                alignItems: 'center',
                fontSize: '4em',
                fontWeight: 'bolder',
                color: 'red',
                textShadow: '2px 2px 4px #000000',
              }}
            >
              Game Over
            </div>
          )}
          {status === 'victory' && (
            <div
              id="overlay"
              style={{
                position: 'absolute',
                width: '100%',
                height: '100%',
                backgroundColor: 'rgba(0,0,0,0.75)',
                display: 'grid',
                alignItems: 'center',
                fontSize: '4em',
                fontWeight: 'bolder',
                color: '#ffd20a',
                textShadow: '2px 2px 4px #000000',
              }}
            >
              You Won!
            </div>
          )}
        </div>

        <Button
          waiting={waiting}
          selectedCellIndex={selectedCellIndex}
          status={status}
          errorMessage={errorMessage}
          tinyMessage={
            tinyMessage ??
            `Number of revealed cells : ${grid.revealed} / ${grid.rows * grid.cols}`
          }
          visible={buttonVisible}
          onClick={handleButtonClick}
        />
      </div>
    </div>
  );
};

export default Minesweeper;
