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
        "initCostCNX": 0
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
- `initCostCNX`: startup cost in whole CNX units, deducted from the first DAO emission in Primary mode. Mirror mode requires this to be `0`.

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
        "slashReceiverAddress": "0x000000000000000000000000000000000000FEE1",
        "nodeMinStakeAmount": "400000000000000000000",
        "delegatedMinStakeAmount": "400000000000000000000",
        "forceUnstakeDelay": 1800
    }
}
```

Parameter requirements:

- `relayOperatorAddress`: Relay runtime signer for `NodeStaking.unstake` and `NodeStaking.slashStaking`.
- `slashReceiverAddress`: immutable slash receiver for both `NodeStaking` and `DelegatedStaking`. This address is set in constructors and cannot be changed after deployment.
- `nodeMinStakeAmount`: constructor argument for the initial minimum native CNX node stake. Crynux-on-base-sepolia MUST use `400e18`. Crynux-on-base MUST use `100000e18`.
- `delegatedMinStakeAmount`: constructor argument for the initial minimum native CNX delegation. Crynux-on-base-sepolia MUST use `400e18`. Crynux-on-base MUST use `100000e18`.
- `forceUnstakeDelay`: initial node force-unstake delay in seconds.

Deploy the L2 node contracts with Hardhat Ignition:

```shell
$ npm run deploy:l2:node-contracts -- --network <network> --parameters ./cache/deploy-l2-node-contracts-params.json
```

The deployment creates `BenefitAddress`, `NodeStaking`, and `DelegatedStaking`. Node staking accepts native CNX only. Stake-amount changes and `NodeStaking.tryUnstake` remain paused until the corresponding staking observer is configured.

After `CouncilRegistry` and `CouncilGovernor` are deployed, configure both staking observers to enable stake-amount changes, then transfer both staking ownerships:

```json
{
    "ConfigureGovernedStaking": {
        "nodeStakingAddress": "0x0000000000000000000000000000000000000001",
        "delegatedStakingAddress": "0x0000000000000000000000000000000000000002",
        "councilRegistryAddress": "0x0000000000000000000000000000000000000003",
        "councilGovernorAddress": "0x0000000000000000000000000000000000000004"
    }
}
```

```shell
$ npm run configure:l2:governed-staking -- --network <network> --parameters ./cache/configure-governed-staking-params.json
```

The current owner MUST verify `NodeStaking.ba`, both `slashReceiver` values, and both `owner` values before this handoff. Existing mainnet and testnet contracts are not proxies and do not change in place. This implementation requires new contract addresses. Existing stake migration and changes in Relay, Admin, Portal, governance contracts, and other repositories are outside this deployment.
