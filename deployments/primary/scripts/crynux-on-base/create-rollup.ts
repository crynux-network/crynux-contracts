import { readFile, writeFile } from 'node:fs/promises';
import { createRollup, createRollupPrepareDeploymentParamsConfig, prepareChainConfig } from '@arbitrum/chain-sdk';
import {
  deploymentConfig,
  getBaseCrynuxTokenAddress,
  getBatchPosterAddress,
  getValidatorAddress,
  getDeployerAccount,
  parentChainPublicClient,
} from './common.js';
import { expectPositionalArgs, getPrimaryLayerFile } from '../common.js';

expectPositionalArgs(0, 'npx tsx deployments/primary/scripts/crynux-on-base/create-rollup.ts');

const contractsFile = getPrimaryLayerFile('crynux-on-base', 'contracts.json');
const contracts = JSON.parse(await readFile(contractsFile, 'utf8'));
const deployer = await getDeployerAccount();
const baseCrynuxTokenAddress = getBaseCrynuxTokenAddress();
const batchPoster = getBatchPosterAddress();
const validator = getValidatorAddress();

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
