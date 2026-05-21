import { createRollupPrepareDeploymentParamsConfig, createRollup, prepareChainConfig } from '@arbitrum/chain-sdk';
import { deploymentConfig, getRollupDeployerAccount, parentChainPublicClient } from './common.js';

const l2ChainId = deploymentConfig.l2ChainId;

const rollupDeployer = await getRollupDeployerAccount();
const chainOwner = rollupDeployer.address;
const batchPoster = deploymentConfig.l2BatchPosterAddress;
const validator = deploymentConfig.l2ValidatorAddress;

const chainConfig = prepareChainConfig({
  chainId: l2ChainId,
  arbitrum: {
    InitialChainOwner: chainOwner,
    DataAvailabilityCommittee: true,
  },
});

const createRollupConfig = createRollupPrepareDeploymentParamsConfig(parentChainPublicClient, {
  chainId: BigInt(l2ChainId),
  owner: chainOwner,
  chainConfig: chainConfig,
  stakeToken: deploymentConfig.l1CrynuxTokenAddress,
});

const createRollupResults = await createRollup({
  params: {
    config: createRollupConfig,
    batchPosters: [batchPoster],
    validators: [validator],
    nativeToken: deploymentConfig.l1CrynuxTokenAddress,
  },
  account: rollupDeployer,
  parentChainPublicClient,
});

console.log('Core contracts:');
console.log(JSON.stringify(createRollupResults.coreContracts, null, 2));
