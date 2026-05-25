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

### Emission ERC-20 Contract Deployment

Create a deployment parameter file for the emission contract:

```json
{
    "DeployEmissionErc20": {
        "tokenAddress": "0x0000000000000000000000000000000000000001",
        "mode": 0,
        "daoTreasuryAddress": "0x0000000000000000000000000000000000000002",
        "relayWalletColdAddress": "0x0000000000000000000000000000000000000003",
        "startTimestamp": 1735689600,
        "initialEmissionIndex": 0,
        "initCost": 0,
        "fundingAmount": "8617333262000000000000000000"
    }
}
```

Parameter requirements:

- `tokenAddress`: deployed `CrynuxToken` address.
- `mode`: emission mode enum value. `0` is Primary and `1` is Mirror.
- `daoTreasuryAddress`: immutable DAO treasury receiver address.
- `relayWalletColdAddress`: immutable relay cold wallet receiver address.
- `startTimestamp`: emission schedule start timestamp in seconds.
- `initialEmissionIndex`: number of already completed emission periods when the contract is deployed.
- `initCost`: startup cost in whole CNX units, deducted from the first DAO emission in Primary mode. Mirror mode requires this to be `0`.
- `fundingAmount`: amount of CNX token units transferred from deployer to `EmissionERC20` during deployment.

Deploy the emission contract with Hardhat Ignition:

```shell
$ npm run deploy:emission:erc20 -- --network <network> --parameters ./cache/deploy-emission-erc20-params.json
```

### L2 Node Contracts Deployment

Create a deployment parameter file for the L2 node contracts:

```json
{
    "DeployNodeContracts": {
        "relayOperatorAddress": "0x000000000000000000000000000000000000dEaD",
        "creditsAdminAddress": "0x000000000000000000000000000000000000bEEF",
        "parameterWriterAddress": "0x000000000000000000000000000000000000c0De",
        "slashReceiverAddress": "0x000000000000000000000000000000000000FEE1"
    }
}
```

Parameter requirements:

- `relayOperatorAddress`: Relay runtime signer for `NodeStaking.unstake` and `NodeStaking.slashStaking`.
- `creditsAdminAddress`: bootstrap credit issuance signer for `Credits.createCredits`.
- `parameterWriterAddress`: initial writer for `ParameterController` governed operational parameter updates.
- `slashReceiverAddress`: immutable slash receiver for both `NodeStaking` and `DelegatedStaking`. This address is set in constructors and cannot be changed after deployment.

Deploy the L2 node contracts with Hardhat Ignition:

```shell
$ npm run deploy:l2:node-contracts -- --network <network> --parameters ./cache/deploy-l2-node-contracts-params.json
```
