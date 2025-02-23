import React from 'react';

import './Button.css';
import { MinesweeperStatus } from '../Minesweeper.types';

type Props = {
  waiting: boolean;
  status: MinesweeperStatus;
  selectedCellIndex: number | undefined;
  errorMessage: string | undefined;
  tinyMessage: string | undefined;
  visible: boolean;
  onClick: () => void;
};

export const Button: React.FC<Props> = ({
  waiting,
  status,
  selectedCellIndex,
  errorMessage,
  tinyMessage,
  visible,
  onClick,
}: Props) => {
  function buttonInfos() {
    switch (status) {
      case 'loading': {
        return {
          loader: true,
          isButton: false,
          text: 'Loading fhEVM Minesweeper, please wait...',
          buttonCSS: 'bg-[#313131]',
          buttonTextCSS: 'text-[#888888]',
          loaderClassName: 'loader-grey',
        };
      }
      case 'error': {
        return {
          loader: false,
          isButton: false,
          text: errorMessage,
          buttonCSS: 'bg-red-700',
          buttonTextCSS: 'text-white',
          loaderClassName: 'loader-black',
        };
      }
      case 'new-game':
      case 'victory':
      case 'game-over': {
        return {
          loader: false,
          isButton: true,
          text: 'Start New Game',
          buttonCSS: 'border-4 border-black bg-white hover:bg-[#ffeea9]',
          buttonTextCSS: 'text-black',
          loaderClassName: 'loader-black',
        };
      }
      case 'starting-game': {
        return {
          loader: true,
          isButton: false,
          text: 'Starting New Game ...',
          buttonCSS: 'bg-[#313131]',
          buttonTextCSS: 'text-[#888888]',
          loaderClassName: 'loader-grey',
        };
      }
      case 'playing-game': {
        if (waiting) {
          return {
            loader: true,
            isButton: false,
            text:
              selectedCellIndex !== undefined
                ? `Computing cell #${selectedCellIndex}...`
                : 'Computing...',
            buttonCSS: 'bg-[#313131]',
            buttonTextCSS: 'text-[#888888]',
            loaderClassName: 'loader-grey',
          };
        } else if (selectedCellIndex !== undefined) {
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
    }
  }

  const buttonCSS = buttonInfos();

  const buttonGroupCN =
    'bg-[#313131] grid w-full max-w-screen-md gap-3 p-3 rounded';
  const submitButtonWrapperCN = 'flex w-full max-w-screen-md gap-2';
  const submitButtonCN = `flex h-18 w-full max-w-screen-md items-center justify-center gap-2 rounded-lg px-4 py-2 ${buttonCSS?.buttonCSS}`;
  const submitButtonTextCN = `w-auto max-w-screen-md text-lg font-semibold ${buttonCSS?.buttonTextCSS}`;
  const tinyMessageTextCN =
    'w-full max-w-screen-md content-center items-center gap-2 text-center text-[#666666] text-xs overflow-hidden text-ellipsis';

  return (
    <div className={buttonGroupCN}>
      <div className={submitButtonWrapperCN}>
        {visible ? (
          <button
            onClick={!waiting && buttonCSS.isButton ? onClick : undefined}
            className={submitButtonCN}
          >
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
      <div className={tinyMessageTextCN}>{tinyMessage}</div>
    </div>
  );
};
