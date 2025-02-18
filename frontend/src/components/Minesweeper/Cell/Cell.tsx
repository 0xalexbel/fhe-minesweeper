import React from 'react';

import './Cell.css';

export type CellState = 'open-bomb' | 'open-num' | 'open-empty' | 'closed';

type Props = {
  id: number;
  state: CellState;
  number: number;
  selected: boolean;
  waiting: boolean;
  onClick: (id: number, state: CellState, selected: boolean) => void;
};

export const Cell: React.FC<Props> = ({
  id,
  state,
  number,
  selected,
  waiting,
  onClick,
}: Props) => {
  if (state === 'closed') {
    if (id === 0) {
      console.log('CLOSED');
    }

    if (!selected) {
      return (
        <div
          id={`Cell${id}`}
          className="Cell_normal"
          onClick={!waiting ? () => onClick(id, state, selected) : undefined}
        ></div>
      );
    } else {
      if (waiting) {
        return (
          <div id={`Cell${id}`} className="Cell_normal Cell_waiting z-1000">
            <div className="loader-yellow" style={{ height: '50%' }}></div>
          </div>
        );
      } else {
        return (
          <div
            id={`Cell${id}`}
            className="Cell_normal Cell_pressed z-1000 rounded text-5xl select-none"
            onClick={() => onClick(id, state, selected)}
          >
            ?
          </div>
        );
      }
    }
  } else if (state === 'open-bomb') {
    return <div id={`Cell${id}`} className="Cell_open Cell_bomb"></div>;
  } else if (state === 'open-num') {
    return (
      <div
        id={`Cell${id}`}
        className="Cell_open select-none text-3xl font-bold"
      >
        {number}
      </div>
    );
  } else if (state === 'open-empty') {
    return <div id={`Cell${id}`} className="Cell_open"></div>;
  }
};
