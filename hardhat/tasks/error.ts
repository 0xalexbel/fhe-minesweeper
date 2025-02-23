import { NomicLabsHardhatPluginError } from "hardhat/plugins";

export class FHEMinesweeperError extends NomicLabsHardhatPluginError {
  constructor(message: string, prefix?: string, parent?: Error) {
    if (prefix) {
      message = prefix + message;
    }
    super("FHEMinesweeper", message, parent);
  }
}
