import { readFile, writeFile } from 'node:fs/promises';
import { createRollup, createRollupPrepareDeploymentParamsConfig, prepareChainConfig } from '@arbitrum/chain-sdk';
import { orbitRuntime, getOrbitLayerFile, deploymentConfig, getParentCrynuxTokenAddress, getBatchPosterAddress, getValidatorAddress, getCoreContracts, getDeployerAccount, parentChainPublicClient } from './runtime.js';
import { validateRollupCreatorV32 } from './validate-rollup-factory.js';
import { expectPositionalArgs } from '../../common.js';

expectPositionalArgs(0, `npx tsx deployments/primary/scripts/${orbitRuntime.scriptDir}/create-rollup.ts`);

const contractsFile = getOrbitLayerFile('contracts.json');
const contracts = JSON.parse(await readFile(contractsFile, 'utf8'));
const deployer = await getDeployerAccount();
const parentCrynuxTokenAddress = getParentCrynuxTokenAddress();
const batchPoster = getBatchPosterAddress();
const validator = getValidatorAddress();

if (typeof contracts.coreContracts?.rollup !== 'string') {
  throw new Error('contracts.json must define coreContracts.rollup as an address or an empty string.');
}

if (contracts.coreContracts.rollup !== '') {
  const recordedCoreContracts = getCoreContracts();
  console.log('Rollup core contracts are already recorded. Skipping rollup creation.');
  console.log(JSON.stringify(recordedCoreContracts, null, 2));
  process.exit(0);
}

await validateRollupCreatorV32();

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
  stakeToken: parentCrynuxTokenAddress,
});

const createRollupResults = await createRollup({
  params: {
    config: createRollupConfig,
    batchPosters: [batchPoster],
    validators: [validator],
    nativeToken: parentCrynuxTokenAddress,
  },
  account: deployer,
  parentChainPublicClient,
});

contracts.coreContracts = createRollupResults.coreContracts;
await writeFile(contractsFile, `${JSON.stringify(contracts, null, 2)}\n`);

console.log('Core contracts:');
console.log(JSON.stringify(createRollupResults.coreContracts, null, 2));
