import { ethers } from 'ethers';
import { useCallback, useState, useEffect } from 'react';
import { Cell, CellState } from './Cell';

import './Minesweeper.css';
import { ContractTransactionResponse } from 'ethers';
import { BigNumberish } from 'ethers';
import { reencryptEuint256 } from '../../../../hardhat/test/reencrypt';
import { getInstance } from '../../fhevmjs';

/*
(0)  1 0 0 0 0 0 0 0 0 0 0 
(1)  0 0 0 0 0 1 0 0 0 0 0 
(2)  0 0 1 0 0 0 0 0 0 0 0 
(3)  0 0 0 0 0 0 0 0 0 0 0 
(4)  0 0 0 1 0 1 0 0 1 0 1 
(5)  1 0 1 1 0 0 0 0 0 1 0 
(6)  1 0 0 0 1 0 0 0 1 1 0 
(7)  0 0 0 1 0 1 0 0 0 0 0 
(8)  0 0 0 0 0 1 0 0 0 1 1 
(9)  0 0 0 0 1 0 0 0 0 0 0 
(10) 0 0 0 0 0 0 1 0 0 0 0 
*/

export type MinesweeperProps = {
  account: string;
  //provider: ethers.Eip1193Provider;
  provider: ethers.BrowserProvider;
  readOnlyProvider: ethers.JsonRpcProvider;
};

interface FHEMinesweeperItf {
  newGame: (level: BigNumberish) => Promise<ContractTransactionResponse>;
  connect(
    runner: null | ethers.ContractRunner,
  ): ethers.BaseContract & FHEMinesweeperItf;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type GridCell = {
  numOfAdjacentBombs: number;
  isBomb: boolean;
  isHidden: boolean;
  isEmpty: boolean;
  isWaiting: boolean;
  isSelected: boolean;
};

// const DEFAULT_CELL: GridCell = {
//   numOfAdjacentBombs: 0,
//   isBomb: false,
//   isHidden: true,
//   isEmpty: false,
//   isWaiting: false,
//   isSelected: false,
// };

const STATUS_LOADING = 0;
const STATUS_ERROR = 1;
const STATUS_PLAYING = 2;
const STATUS_NEW_GAME = 3;
const STATUS_GAME_OVER = 4;
const STATUS_VICTORY = 5;

//@ts-ignore
export const Minesweeper = ({
  account,
  provider,
  readOnlyProvider,
}: MinesweeperProps) => {
  const sz = 11;

  const [status, setStatus] = useState(STATUS_LOADING);
  const [waiting, setWaiting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [message, setMessage] = useState<string>('Zama fhEVM Minesweeper');
  //@ts-ignore
  const [rows, setRows] = useState(sz); // Grid size (rows & columns)
  //@ts-ignore
  const [cols, setCols] = useState(sz); // Grid size (rows & columns)
  const [grid, setGrid] = useState(new Array<GridCell>(sz * sz)); // Grid size (rows & columns)
  const [selectedCellIndex, setSelectedCellIndex] = useState(-1);
  //@ts-ignore
  const [contractAddress, setContractAddress] = useState(ethers.ZeroAddress);

  useEffect(() => {
    const loadData = async () => {
      setStatus(STATUS_LOADING);
      setMessage(`Loading fhEVM Minesweeper...`);
      setSelectedCellIndex(-1);
      setupContractAddress(ethers.ZeroAddress);
      resetGrid();

      try {
        // Conditional import based on MOCKED environment variable
        let FHEMinesweeper;
        if (!import.meta.env.MOCKED) {
          FHEMinesweeper = await import(
            //@ts-ignore
            '@deployments/sepolia/FHEMinesweeper.json'
          );
          console.log(
            `Using ${FHEMinesweeper.address} for the token address on Sepolia`,
          );
        } else {
          FHEMinesweeper = await import(
            //@ts-ignore
            '@deployments/localhost/FHEMinesweeper.json'
          );
          console.log(
            `Using ${FHEMinesweeper.address} for the token address on Hardhat Local Node`,
          );
        }

        const signer = await provider.getSigner();
        const board = await getBoard(FHEMinesweeper.address, signer);

        resetGrid(board);

        setupContractAddress(FHEMinesweeper.address);
        if (!board) {
          setStatus(STATUS_NEW_GAME);
        } else {
          const res = await getVictoryOrGameOver(
            FHEMinesweeper.address,
            signer,
          );

          // There is a bug in "hardhat node" mode. The game over flag is not properly set.
          if (hasBombInBoard(board.board)) {
            setStatus(STATUS_GAME_OVER);
          } else {
            if (res) {
              if (res.victory) {
                setStatus(STATUS_VICTORY);
              } else if (res.gameOver) {
                console.log('VOILA');
                setStatus(STATUS_GAME_OVER);
              } else {
                setStatus(STATUS_PLAYING);
              }
            } else {
              setStatus(STATUS_PLAYING);
            }
          }
        }

        setSelectedCellIndex(-1);
        setMessage(`FHEMinesweeper : ${FHEMinesweeper.address}`);
      } catch (error) {
        setError(
          `Minesweeper contract is not deployed`,
          (error as Error).message,
        );
        setupContractAddress(ethers.ZeroAddress);

        console.error(
          'Error loading data - you probably forgot to deploy the token contract before running the front-end server:',
          error,
        );
      }
    };

    loadData();
  }, []);

  function setupContractAddress(address: string) {
    setContractAddress(address);
  }

  function setError(txt: string, detail: string) {
    setStatus(STATUS_ERROR);
    setWaiting(false);
    setErrorMessage(txt);
    setMessage(detail);
    setSelectedCellIndex(-1);
  }

  const getVictoryOrGameOver = async (
    contractAddr: string,
    player: ethers.JsonRpcSigner,
  ) => {
    if (contractAddr != ethers.ZeroAddress) {
      // const FHEMinesweeper = await import(
      //   //@ts-ignore
      //   '@deployments/localhost/FHEMinesweeper.json'
      // );

      // const contract = new ethers.Contract(
      //   contractAddr,
      //   FHEMinesweeper.abi,
      //   player,
      // );

      const contract = new ethers.Contract(
        contractAddr,
        [
          'function isItAVictory() external view returns (bool)',
          'function isItGameOver() external view returns (bool)',
        ],
        player,
      );

      const victory = await contract.isItAVictory();
      const gameOver = await contract.isItGameOver();

      console.log('gameOver= ' + gameOver);

      return {
        victory: victory === true,
        gameOver: gameOver === true,
      };
    }
  };

  // async function decryptBoard(encBoard: bigint) {
  //   const instance = getInstance();

  //   const signer = await provider.getSigner();
  //   try {
  //     const clearBoard = await reencryptEuint256(
  //       //@ts-ignore
  //       signer,
  //       instance,
  //       encBoard,
  //       contractAddress,
  //     );
  //     console.log(clearBoard);
  //   } catch (error) {
  //     console.log(error);
  //   }
  // }

  function parseCacheRow4x256(cacheRow4x256: bigint, len: number) {
    const res: number[] = [];
    const n_cols = Math.min(256 / 4, len);
    for (let i = 0; i < n_cols; ++i) {
      res.push(ethers.toNumber((cacheRow4x256 >> BigInt(i * 4)) & BigInt(0xf)));
    }
    return res;
  }

  function parseCache4x256(cache4x256: bigint[], len: number) {
    let res: number[] = [];
    let remaining = len;
    for (let i = 0; i < cache4x256.length; ++i) {
      const n = Math.min(256 / 4, remaining);
      if (n == 0) {
        break;
      }
      res = res.concat(parseCacheRow4x256(cache4x256[i], n));
      remaining -= n;
    }

    return res;
  }

  function parseMoves(moves: bigint) {
    const arr: number[] = [];
    for (let i = 0; i < sz * sz; ++i) {
      const a = 1n << (BigInt(i) * 2n);
      const isOne = (moves & a) > 0n;
      arr.push(isOne ? 1 : 0);
    }
    return arr;
  }

  const getBoard = async (
    contractAddr: string,
    player: ethers.JsonRpcSigner,
  ) => {
    if (contractAddr != ethers.ZeroAddress) {
      const contract = new ethers.Contract(
        contractAddr,
        [
          'function getClearCacheRows256() external view returns (uint256, uint256)',
          'function moves() external view returns (uint256)',
          'function hasGameInProgress() external view returns (bool)',
        ],
        player,
      );
      if (!(await contract.hasGameInProgress())) {
        return undefined;
      }

      const moves: bigint = await contract.moves();
      const res = await contract.getClearCacheRows256();

      console.log('res[0] = ' + res[0]);
      console.log('res[1] = ' + res[1]);
      console.log('res[0] = ' + ethers.toBeHex(res[0], 32));
      console.log('res[1] = ' + ethers.toBeHex(res[1], 32));

      if (sz != 11) {
        throw new Error('Unexpected Size');
      }

      return {
        board: parseCache4x256([res[0], res[1]], sz * sz),
        moves: parseMoves(moves),
      };
    }
  };

  // const revealCellTest = async (
  //   cellIndex: number,
  //   contractAddr: string,
  //   grid: Array<GridCell>,
  // ) => {
  //   setWaiting(true);

  //   try {
  //     await sleep(500);
  //     const clearValue =
  //       cellIndex % 3 == 0 ? 0 : cellIndex % 3 == 1 ? cellIndex % 9 : 9;

  //     const isBomb = clearValue >= 9;
  //     console.log('grid[0].isHidden = ' + grid[0].isHidden);
  //     grid[cellIndex] = {
  //       isBomb,
  //       isEmpty: clearValue == 0,
  //       isHidden: false,
  //       isSelected: false,
  //       isWaiting: false,
  //       numOfAdjacentBombs: clearValue < 9 ? clearValue : 0,
  //     };

  //     setGrid(grid);
  //     setSelectedCellIndex(-1);
  //     setWaiting(false);
  //     if (isBomb) {
  //       setStatus(STATUS_GAME_OVER);
  //     } else {
  //       setStatus(STATUS_PLAYING);
  //     }
  //   } catch (e) {
  //     setError(`Reveal cell #${cellIndex} failed.`, (e as Error).message);
  //   }
  // };

  async function getPastEvents(
    address: string,
    player: string,
    cellIndex: number,
    fromBlock?: ethers.BlockTag,
    toBlock?: ethers.BlockTag,
  ): Promise<
    Array<{
      player: string;
      cellIndex: number;
      cellValue: number;
      victory: boolean;
    }>
  > {
    try {
      const abi = [
        'event CellRevealed(address player, uint8 cellIndex, uint8 cellValue, bool victory)',
      ];
      const iface = new ethers.Interface(abi);
      const filter = {
        address,
        fromBlock,
        toBlock,
      };
      const arr: Array<{
        player: string;
        cellIndex: number;
        cellValue: number;
        victory: boolean;
      }> = [];
      const logs = await readOnlyProvider.getLogs(filter);
      for (let i = 0; i < logs.length; ++i) {
        const l = iface.parseLog(logs[i]);
        if (l === null) {
          continue;
        }
        if (l.args[0] !== player) {
          continue;
        }
        if (Number(l.args[1]) !== cellIndex) {
          continue;
        }
        arr.push({
          player,
          cellIndex: cellIndex,
          cellValue: Number(l.args[2]),
          victory: Boolean(l.args[3]),
        });
      }
      return arr;
    } catch (e) {
      console.log((e as Error).message);
      return [];
    }
  }

  const revealCell = async (
    cellIndex: number,
    contractAddr: string,
    grid: Array<GridCell>,
  ) => {
    setWaiting(true);

    try {
      const signer = await provider.getSigner();

      // const FHEMinesweeper = await import(
      //   //@ts-ignore
      //   '@deployments/localhost/FHEMinesweeper.json'
      // );

      // const contract = new ethers.Contract(
      //   contractAddr,
      //   FHEMinesweeper.abi,
      //   signer,
      // );

      const contract = new ethers.Contract(
        contractAddr,
        [
          'function revealCell(uint8 cellIndex) external',
          'function isItGameOver() external view returns (bool)',
          'function getClearCell(uint8 cellIndex) external view returns (uint8)',
          'function isClearCellAvailable(address player, uint8 cellIndex) external view returns (bool)',
        ],
        signer,
      );
      const tx = await contract.revealCell(cellIndex);

      // /////////////////////////////////////////
      // let waitCount = 1;
      // // IN MOCK
      // if (import.meta.env.MOCKED) {
      //   waitCount = 2;
      //   await sleep(1000); //ok
      //   await readOnlyProvider.send('evm_mine', []);
      //   await readOnlyProvider.send('evm_mine', []);
      //   await sleep(1000);
      // }
      // /////////////////////////////////////////

      const receipt: ethers.ContractTransactionReceipt = await tx.wait(1);
      if (receipt.status === 0) {
        throw new Error(`Tx ${receipt.hash} reverted.`);
      }
      //http://localhost:4173/

      // for (let i = 0; i < 100; ++i) {
      //   const gameOver = await contract.isItGameOver();
      //   console.log('GAMEOVER=' + gameOver);
      //   await sleep(2000);
      // }

      // for (let i = 0; i < 100; ++i) {
      //   await sleep(2000);
      //   const logs = await getPastEvents(
      //     contractAddr,
      //     signer.address,
      //     cellIndex,
      //     receipt.blockNumber,
      //   );
      //   if (logs.length > 0) {
      //     break;
      //   }
      // }

      for (let i = 0; i < 100; ++i) {
        await sleep(7000);
        const ok = await contract.isClearCellAvailable(
          signer.address,
          cellIndex,
        );
        if (ok === true) {
          setMessage('Decrypted cell is now available on-chain.');
          break;
        }
        setMessage(
          `Decrypted cell value is not yet available on-chain (${i + 1}%)`,
        );
      }

      for (let i = 0; i < 10; ++i) {
        const gameOver = await contract.isItGameOver();

        if (gameOver === true) {
          // We have clicked on a bomb
          grid[cellIndex] = getGridCellFromValue4PlusOne(Number(9) + 1);
          setGrid(grid);
          setSelectedCellIndex(-1);
          setWaiting(false);
          setStatus(STATUS_GAME_OVER);
          return;
        }

        try {
          const clearValue: bigint = await contract.getClearCell(cellIndex);
          console.log(`CLEAR[${cellIndex}] = ${clearValue}`);
          grid[cellIndex] = getGridCellFromValue4PlusOne(
            Number(clearValue) + 1, // need value4 + 1
          );

          setGrid(grid);
          break;
        } catch (e) {
          // Quick and dirty. Should be handle the right way.
          if ((e as Error).message.indexOf('Game Over') >= 0) {
            setSelectedCellIndex(-1);
            setWaiting(false);
            setStatus(STATUS_GAME_OVER);
            return;
          }
          console.log('ERROR');
          console.log((e as Error).message);
        }
      }

      setSelectedCellIndex(-1);
      setWaiting(false);
      setStatus(STATUS_PLAYING);
    } catch (e) {
      setError(`Reveal cell #${cellIndex} failed.`, (e as Error).message);
    }
  };

  const newGame = async (contractAddr: string) => {
    setWaiting(true);
    resetGrid();

    try {
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(
        contractAddr,
        [
          'function boardOf(address player) external view returns (uint256)',
          'function newGame(uint8 level) external',
          'function setDeterministicMode(bool enable) external',
          'function hasGameInProgress() public view returns (bool)',
        ],
        signer,
      );
      // In test mode, use deterministic method
      let tx = await contract.setDeterministicMode(true);
      let receipt: ethers.ContractTransactionReceipt = await tx.wait(1);
      if (receipt.status === 0) {
        throw new Error(`Tx ${receipt.hash} reverted.`);
      }

      tx = await contract.newGame(0n);
      receipt = await tx.wait(1);
      if (receipt.status === 0) {
        throw new Error(`Tx ${receipt.hash} reverted.`);
      }

      const ok = await contract.hasGameInProgress();
      if (!ok) {
        throw new Error(`Contract error: 'hasGameInProgress() == false'`);
      }

      // // Debug
      // const encBoard = await contract.boardOf(signer);
      // await decryptBoard(encBoard);

      setWaiting(false);
      setStatus(STATUS_PLAYING);
    } catch (e) {
      setError(`Create new game failed.`, (e as Error).message);
    }
  };

  function getCellState(cellIndex: number): CellState {
    const cell: GridCell = grid[cellIndex];
    if (!cell) {
      return 'closed';
    }

    if (cell.isHidden) {
      return 'closed';
    }
    if (cell.isBomb) {
      return 'open-bomb';
    }
    if (cell.isEmpty) {
      return 'open-empty';
    }
    return 'open-num';
  }

  function buttonInfos() {
    if (status === STATUS_LOADING) {
      return {
        loader: true,
        isButton: false,
        text: 'Loading fhEVM Minesweeper, please wait...',
        buttonCSS: 'bg-[#313131]',
        buttonTextCSS: 'text-[#888888]',
        loaderClassName: 'loader-grey',
      };
    } else if (
      status === STATUS_NEW_GAME ||
      status === STATUS_GAME_OVER ||
      status == STATUS_VICTORY
    ) {
      if (waiting) {
        return {
          loader: true,
          isButton: false,
          text: 'Starting New Game ...',
          buttonCSS: 'bg-[#313131]',
          buttonTextCSS: 'text-[#888888]',
          loaderClassName: 'loader-grey',
        };
      } else {
        return {
          loader: false,
          isButton: true,
          text: 'Start New Game',
          buttonCSS: 'border-4 border-black bg-white hover:bg-[#ffeea9]',
          buttonTextCSS: 'text-black',
          loaderClassName: 'loader-black',
        };
      }
    } else if (status === STATUS_ERROR) {
      return {
        loader: false,
        isButton: false,
        text: errorMessage,
        buttonCSS: 'bg-red-700',
        buttonTextCSS: 'text-white',
        loaderClassName: 'loader-black',
      };
    } else if (status === STATUS_PLAYING) {
      if (waiting) {
        return {
          loader: true,
          isButton: false,
          text:
            selectedCellIndex >= 0
              ? `Computing cell #${selectedCellIndex}...`
              : 'Computing...',
          buttonCSS: 'bg-[#313131]',
          buttonTextCSS: 'text-[#888888]',
          loaderClassName: 'loader-grey',
        };
      } else if (selectedCellIndex >= 0) {
        return {
          loader: false,
          isButton: true,
          text: "Click the '?' to confirm your choice",
          buttonCSS: 'bg-[#313131]',
          buttonTextCSS: 'text-white',
          loaderClassName: 'loader-black',
        };
      }
      return {
        loader: false,
        isButton: false,
        text: 'Select a cell',
        buttonCSS: 'bg-[#313131]',
        buttonTextCSS: 'text-white',
        loaderClassName: 'loader-black',
      };
    }

    return {
      loader: false,
      isButton: false,
      text: 'PROBLEMOS',
      buttonCSS: 'bg-green-700',
      buttonTextCSS: 'text-white',
      loaderClassName: 'loader-black',
    };
  }

  function onClickSubmitButton() {
    if (waiting) {
      return;
    }
    if (
      status == STATUS_NEW_GAME ||
      status == STATUS_GAME_OVER ||
      status == STATUS_VICTORY
    ) {
      newGame(contractAddress);
    } else {
      if (selectedCellIndex < 0) {
        return;
      }
      setMessage(waiting ? '' : 'Please wait...');
      setWaiting(!waiting);
    }
  }

  const onCellSelectedChanged = useCallback(
    //@ts-ignore
    (id: number, state: CellState, selected: boolean) => {
      if (status !== STATUS_PLAYING) {
        return;
      }
      if (!selected) {
        setSelectedCellIndex(id);
      } else {
        setWaiting(true);
        setMessage(`Call 'revealCell()'. Please wait...`);
        revealCell(id, contractAddress, grid);
      }
    },
    [contractAddress, status, grid],
  );

  function getGridCellFromValue4PlusOne(value4PlusOne: number) {
    if (value4PlusOne === 0) {
      return {
        isBomb: false,
        isEmpty: false,
        isHidden: true,
        isSelected: false,
        isWaiting: false,
        numOfAdjacentBombs: 0,
      };
    }
    return {
      isBomb: value4PlusOne >= 9 + 1,
      isEmpty: value4PlusOne <= 0 + 1,
      isHidden: false,
      isSelected: false,
      isWaiting: false,
      numOfAdjacentBombs:
        value4PlusOne < 9 + 1 && value4PlusOne >= 0 + 1 ? value4PlusOne - 1 : 0,
    };
  }

  function hasBombInBoard(board: number[]) {
    for (let i = 0; i < board.length; ++i) {
      if (board[i] >= 9 + 1) {
        return true;
      }
    }
    return false;
  }

  function resetGrid(defautGrid?: { board: number[]; moves: number[] }) {
    const newGrid: GridCell[] = [];

    for (let i = 0; i < sz * sz; ++i) {
      if (defautGrid) {
        const isHidden: boolean = defautGrid.moves[i] == 0;
        if (isHidden) {
          newGrid.push({
            isBomb: false,
            isEmpty: false,
            isHidden: true,
            isSelected: false,
            isWaiting: false,
            numOfAdjacentBombs: 0,
          });
        } else {
          newGrid.push(getGridCellFromValue4PlusOne(defautGrid.board[i]));
        }
      } else {
        newGrid.push({
          isBomb: false,
          isEmpty: false,
          isHidden: true,
          isSelected: false,
          isWaiting: false,
          numOfAdjacentBombs: 0,
        });
      }
    }
    setGrid(newGrid);
  }

  const rootCN =
    'flex flex-col items-center bg-[#ffd209] max-w-screen-md w-full';
  const titleWrapperCN =
    'flex h-full w-full justify-center gap-4 border-solid bg-[#ffd209] p-10 align-middle text-5xl font-bold tracking-tight text-black';
  const gridWrapperCN =
    'flex w-full flex-col items-center gap-4 bg-black p-4 pt-20 rounded-xl';
  const gridCN =
    'grid w-full max-w-screen-md rounded bg-[#313131] p-2 aspect-1 cursor-default';
  const buttonGroupCN =
    'bg-[#313131] grid w-full max-w-screen-md gap-3 p-3 rounded';
  const submitButtonWrapperCN = 'flex w-full max-w-screen-md gap-2';

  const buttonCSS = buttonInfos();
  const submitButtonCN = `flex h-18 w-full max-w-screen-md items-center justify-center gap-2 rounded-lg px-4 py-2 ${buttonCSS?.buttonCSS}`;
  const submitButtonTextCN = `w-auto max-w-screen-md text-lg font-semibold ${buttonCSS?.buttonTextCSS}`;
  // const submitButtonCN = `flex h-18 w-full max-w-screen-md items-center gap-2 rounded-lg px-4 py-2 transition ${selectedCellIndex >= 0 ? 'border-4 border-red-500 bg-red-700' : 'bg-[#313131]'} text-white`;
  // const submitButtonTextCN = `w-full max-w-screen-md text-lg font-semibold transition ${waiting ? '' : selectedCellIndex >= 0 ? 'bg-red-700' : 'bg-[#313131]'}`;
  const messageTextCN =
    'w-full max-w-screen-md content-center items-center gap-2 text-center text-[#666666] text-xs overflow-hidden text-ellipsis';

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
      <div className={gridWrapperCN}>
        {/* Dynamic Grid */}
        <div
          className={gridCN}
          style={{
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridTemplateRows: `repeat(${rows}, 1fr)`,
            position: 'relative',
          }}
        >
          {[...Array(rows * cols)].map((_, i) => (
            <Cell
              key={i}
              id={i}
              state={getCellState(i)}
              number={grid[i] ? grid[i].numOfAdjacentBombs : 0}
              selected={i === selectedCellIndex}
              waiting={waiting}
              onClick={onCellSelectedChanged}
            />
          ))}
          {status === STATUS_GAME_OVER && (
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
          {status === STATUS_VICTORY && (
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

        <div className={buttonGroupCN}>
          <div className={submitButtonWrapperCN}>
            {status != 1000 ? (
              <button onClick={onClickSubmitButton} className={submitButtonCN}>
                {buttonCSS.loader ? (
                  <div className={buttonCSS.loaderClassName}></div>
                ) : (
                  <></>
                )}
                <div className={submitButtonTextCN}>{buttonCSS.text}</div>
              </button>
            ) : (
              <></>
            )}
          </div>
          <div className={messageTextCN}>{message}</div>
        </div>
      </div>
    </div>
  );
};

export default Minesweeper;
