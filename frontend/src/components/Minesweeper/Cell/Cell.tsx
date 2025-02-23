import React from 'react';

import './Cell.css';

export type CellProps = {
  id: number;
  number?: number;
  selected?: boolean;
  waiting?: boolean;
  enabled?: boolean;
  onClick?: (id: number, selected: boolean, waiting: boolean) => void;
};

export const Cell: React.FC<CellProps> = ({
  id,
  number,
  selected,
  waiting,
  enabled,
  onClick,
}: CellProps) => {
  number ??= 0;
  selected ??= false;
  waiting ??= false;
  enabled ??= false;

  const revealed = number > 0;
  const numOfAdjacentBombs = revealed ? number - 1 : 0;

  if (!enabled) {
    return <div id={`Cell${id}`} className="Cell_disabled select-none"></div>;
  }

  if (!revealed) {
    if (!selected) {
      return (
        <div
          id={`Cell${id}`}
          className={waiting ? 'Cell_normal_waiting' : 'Cell_normal'}
          onClick={onClick ? () => onClick(id, selected, waiting) : undefined}
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
            onClick={onClick ? () => onClick(id, selected, waiting) : undefined}
          >
            ?
          </div>
        );
      }
    }
  } else if (numOfAdjacentBombs >= 9) {
    return <div id={`Cell${id}`} className="Cell_open Cell_bomb"></div>;
  } else if (numOfAdjacentBombs >= 1) {
    return (
      <div
        id={`Cell${id}`}
        className="Cell_open select-none text-3xl font-bold"
      >
        {numOfAdjacentBombs}
      </div>
    );
  } else {
    // num == 0
    return <div id={`Cell${id}`} className="Cell_open"></div>;
  }
};
