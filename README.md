## The Smart Contracts for the Crynux Network

The solidity contracts to coordinate the nodes and tasks.

### Current Contract Scope

For the current off-chain task dispatch architecture and the active Relay integration contract set, see [./docs/contract-roles-and-status.md](./docs/contract-roles-and-status.md).

### Task State Transitions
![Task State Transitions](./docs/state-transitions.png)

### Compilation

The contracts are developed using Hardhat 3.

Install the dependencies before compilation:

```shell
$ npm install
```

Run the Hardhat compile command using npm:

```shell
$ npm run compile
```

### L1 ERC-20 Crynux Token Deployment

Store the rollup deployer private key in the Hardhat keystore:

```shell
$ npx hardhat keystore set L2_ROLLUP_DEPLOYER_PRIVATE_KEY
```

Generate a new wallet when a fresh deployer account is required:

```shell
$ npx tsx scripts/generate-wallet.ts
```

Base mainnet uses `https://mainnet.base.org` by default. Base Sepolia uses `https://sepolia.base.org` by default. Set `BASE_RPC_URL` or `BASE_SEPOLIA_RPC_URL` in the environment to override either endpoint.

Deploy the L1 ERC-20 Crynux token with Hardhat Ignition:

```shell
$ npm run deploy:l1:erc20-crynux-token -- --network <network>
```
