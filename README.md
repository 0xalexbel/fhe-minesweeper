<p align="center">
<img src="https://github.com/user-attachments/assets/b6942766-af35-435f-afd3-abcbe50d0ead" width="300" height="300">
</p>

# FHEMinesweeper


## Run tests

```bash
npx hardhat test
```

## Deploy on Sepolia

```bash
npm run deploy-sepolia
```

## Playing using the CLI

### Default Test Board

```
(0)  0 1 0 0 0 0 0 0 0 0 0
(1)  0 0 1 1 0 0 0 0 0 1 0
(2)  0 0 0 0 0 0 0 0 0 1 0
(3)  0 0 0 0 0 0 0 0 0 0 0
(4)  1 0 0 0 0 1 0 0 0 0 1
(5)  0 0 0 0 0 0 0 0 0 0 0
(6)  0 0 1 1 0 0 0 0 0 0 0
(7)  0 0 0 0 0 0 0 0 0 0 1
(8)  0 0 0 0 0 0 1 0 0 0 0
(9)  0 0 0 0 0 0 0 1 0 0 0
(10) 0 0 0 0 0 0 0 0 0 0 0
```

```bash
# Account #1 creates a default board game for player with account #0
# The first clean cell is located at row=7 col=5
npx hardhat --network sepolia minesweeper create --player 0 --creator 1
```

```bash
# Account #0 wants to reveal the first cell at row 7 and column 5
npx hardhat --network sepolia minesweeper play --row 7 --col 5
```

The output is:

```bash
(0)   X  X  X  X  X  X  X  X  X  X  X
(1)   X  X  X  X  X  X  X  X  X  X  X
(2)   X  X  X  X  X  X  X  X  X  X  X
(3)   X  X  X  X  X  X  X  X  X  X  X
(4)   X  X  X  X  X  X  X  X  X  X  X
(5)   X  X  X  X  X  X  X  X  X  X  X
(6)   X  X  X  X  X  X  X  X  X  X  X
(7)   X  X  X  X  X  1  X  X  X  X  X
(8)   X  X  X  X  X  X  X  X  X  X  X
(9)   X  X  X  X  X  X  X  X  X  X  X
(10)  X  X  X  X  X  X  X  X  X  X  X
```

```bash
# Account #0 wants to reveal cell at row 6 and column 5
npx hardhat --network sepolia minesweeper play --row 6 --col 5
# etc...
```

```bash
# To display the current board game (played by account #0)
npx hardhat --network sepolia minesweeper print-board
```

## Playing using the UI

### In simulator mode

The command below will run the dApp in full simulation mode. This was a `costly` workaround to have the UI running in mock mode. A full `typescript` version of the contract has been developed to mock the solidity behaviour.

```bash
cd ./frontend/
# Runs a simulator instead of the expected 'hardhat node' since the gateway is not working
npm run dev-sim
```

### On Sepolia

```bash
cd ./frontend/
npm run dev
```

## Issues

- The minesweeper uses the gateway for on-chain decryption which does not seem to be 100% accurate in `hardhat node` mock mode.
  There seem to be racing issues between the gateway decryptor and the chain. I have not been able to figure out the problem (but it
  took me a ton of time).
- However, the contract works well on sepolia.

## The algorithm

- I tried to use as many bitwise operations as possible to minimize the FHE gas cost.
- As always, the more you the FHE gas is optimized the more expensive it is in term of native EVM gas.

# fhevm-react-template

This is an example dApp made with React.js to let users do transfers of a `ConfidentialERC20` token on fhEVM. It contains also a button to request the decryption of an encrypted secret value.

## How to use this repo

You can either deploy the dApp on the real fhEVM coprocessor on the Ethereum Sepolia testnet, or on a local Hardhat node (i.e a mocked corpocessor).

### How to deploy on Sepolia

First, before launching the React app, you must deploy the `ConfidentialERC20` smart contract and mint the first few tokens.
To do this, go to the `hardhat/` directory, and follow all the instructions from the [`README`](/hardhat/README.md) there to deploy and mint the first tokens with Alice's account, i.e until you are able to run the following command:

```
npm run deploy-sepolia
```

> **Note:** Be careful to use your own private mnemonic key in this case, in the `.env` file (do not reuse the public values from `.env.example`!).

After you succesfully run the Sepolia deployment script, go to the `frontend/` directory, and just run those two commands:

```
npm install
npm run dev
```

This will launch the front-end of the dApp from a local Vite server, which will be available at the following URL: [`http://localhost:4173/`](http://localhost:4173/) . You can connect to the dApp with a Web3 wallet such as Metamask and start transferring tokens, reencrypt and read your balance, or request the decryption of the encrypted secret on Sepolia.

### How to use in Mocked mode

First go to the `hardhat/` directory : define a new `.env` file - in mocked mode, simply doing a copy `cp .env.example .env` is doable, but you can also you your own private mnemonic - then install all packages with
`npm i`. Now you can launch the hardhat local node with:

```
npx hardhat node
```

This will also launch a mocked instance of the coprocessor.

Then, open a new tab in your terminal and go to the `frontend/` directory, and just run those three commands:

```
cp .env.example .env
npm install
npm run dev-mocked
```

The dApp will be available again at: [`http://localhost:4173/`](http://localhost:4173/) . You can connect to the dApp with a Web3 wallet such as Metamask and start transferring tokens, reencrypt and read your balance, or request the decryption of the encrypted. This time, the only difference is that it will ask you to connect to the Hardhat network instead of Sepolia, so make sure to have added the Hardhat network to your Metamask wallet in order to be able to use the dApp with the mocked coprocessor. You can find instructions to configure Metamask adequatly [here](https://support.chainstack.com/hc/en-us/articles/4408642503449-Using-MetaMask-with-a-Hardhat-node).

#### Troubleshooting

**_Invalid nonce errors:_** This is a common issue everytime you restart your local Hardhat node and you want to reuse the same accounts in Metamask. You should remember to reset the nonce of the accounts you used the last time with Hardhat. To reset the account's transaction history and the nonce, open Metamask and select the Hardhat network, click on your account followed by `Settings -> Advanced -> Clear activity tab data`.

Another common issue, also due to Metamask not getting synced properly with Hardhat node sometimes if you restart your local node, is that you could get the frontend stuck at the loading page state. A simple fix for this issue is to simply close and restart your browser.
