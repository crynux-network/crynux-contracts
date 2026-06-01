import { readFile, writeFile } from 'node:fs/promises';
import { createRollup, createRollupPrepareDeploymentParamsConfig, prepareChainConfig } from '@arbitrum/chain-sdk';
import { privateKeyToAccount } from 'viem/accounts';
import {
  deploymentConfig,
  getBaseCrynuxTokenAddress,
  getConfiguredBatchPosterPrivateKey,
  getConfiguredValidatorPrivateKey,
  getDeployerAccount,
  parentChainPublicClient,
} from './common.js';

const contractsFile = new URL('./contracts.json', import.meta.url);
const contracts = JSON.parse(await readFile(contractsFile, 'utf8'));
const deployer = await getDeployerAccount();
const baseCrynuxTokenAddress = getBaseCrynuxTokenAddress();
const batchPoster = privateKeyToAccount(await getConfiguredBatchPosterPrivateKey()).address;
const validator = privateKeyToAccount(await getConfiguredValidatorPrivateKey()).address;

if (contracts.coreContracts?.rollup !== '') {
  console.log('Rollup core contracts are already recorded. Skipping rollup creation.');
  console.log(JSON.stringify(contracts.coreContracts, null, 2));
  process.exit(0);
}

const chainConfig = prepareChainConfig({
  chainId: deploymentConfig.chainId,
  arbitrum: {
    InitialChainOwner: deployer.address,
    DataAvailabilityCommittee: true,
  },
});

const createRollupConfig = createRollupPrepareDeploymentParamsConfig(parentChainPublicClient, {
  chainId: BigInt(deploymentConfig.chainId),
  owner: deployer.address,
  chainConfig,
  stakeToken: baseCrynuxTokenAddress,
});

const createRollupResults = await createRollup({
  params: {
    config: createRollupConfig,
    batchPosters: [batchPoster],
    validators: [validator],
    nativeToken: baseCrynuxTokenAddress,
  },
  account: deployer,
  parentChainPublicClient,
});

contracts.coreContracts = createRollupResults.coreContracts;
await writeFile(contractsFile, `${JSON.stringify(contracts, null, 2)}\n`);

console.log('Core contracts:');
console.log(JSON.stringify(createRollupResults.coreContracts, null, 2));
