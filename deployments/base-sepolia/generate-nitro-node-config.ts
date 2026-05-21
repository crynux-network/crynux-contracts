import { writeFile } from 'node:fs/promises';
import { prepareChainConfig, createRollupPrepareDeploymentParamsConfig, prepareNodeConfig } from '@arbitrum/chain-sdk';
import { getAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  deploymentConfig,
  getConfiguredBatchPosterPrivateKey,
  getConfiguredRollupDeployerPrivateKey,
  getConfiguredValidatorPrivateKey,
  getCoreContracts,
  getDacKeysetConfig,
  getDacRestUrls,
  parentChain,
  parentChainPublicClient,
  parentChainRpcUrl,
} from './common.js';

const outputFile = new URL('./nitro-node.json', import.meta.url);

function assertPrivateKeyAddress(privateKey: Hex, expectedAddress: Hex, configKey: string) {
  const actualAddress = privateKeyToAccount(privateKey).address;

  if (getAddress(actualAddress) !== getAddress(expectedAddress)) {
    throw new Error(`${configKey} does not match its configured address.`);
  }
}

const rollupDeployer = privateKeyToAccount(await getConfiguredRollupDeployerPrivateKey());
const batchPosterPrivateKey = await getConfiguredBatchPosterPrivateKey();
const validatorPrivateKey = await getConfiguredValidatorPrivateKey();

assertPrivateKeyAddress(batchPosterPrivateKey, deploymentConfig.l2BatchPosterAddress, 'L2_BATCH_POSTER_PRIVATE_KEY');
assertPrivateKeyAddress(validatorPrivateKey, deploymentConfig.l2ValidatorAddress, 'L2_VALIDATOR_PRIVATE_KEY');

const coreContracts = getCoreContracts();
const dacKeysetConfig = getDacKeysetConfig();
const dacRestUrls = getDacRestUrls();
const chainConfig = prepareChainConfig({
  chainId: deploymentConfig.l2ChainId,
  arbitrum: {
    InitialChainOwner: rollupDeployer.address,
    DataAvailabilityCommittee: true,
  },
});
const createRollupConfig = createRollupPrepareDeploymentParamsConfig(parentChainPublicClient, {
  chainId: BigInt(deploymentConfig.l2ChainId),
  owner: rollupDeployer.address,
  chainConfig,
  stakeToken: deploymentConfig.l1CrynuxTokenAddress,
});

const nitroNodeConfig = prepareNodeConfig({
  chainName: 'Crynux on Base Sepolia',
  chainConfig,
  coreContracts,
  batchPosterPrivateKey,
  validatorPrivateKey,
  stakeToken: createRollupConfig.stakeToken,
  parentChainId: parentChain.id,
  parentChainRpcUrl,
});

if (nitroNodeConfig.node?.['batch-poster'] !== undefined) {
  const batchPosterMaxSize = nitroNodeConfig.node['batch-poster']['max-size'];

  delete nitroNodeConfig.node['batch-poster']['max-size'];

  if (batchPosterMaxSize !== undefined && nitroNodeConfig.node['data-availability'] !== undefined) {
    const dataAvailabilityConfig = nitroNodeConfig.node['data-availability'] as Record<string, unknown>;
    dataAvailabilityConfig['max-batch-size'] = batchPosterMaxSize;
  }
}

if (nitroNodeConfig.node?.['data-availability'] !== undefined) {
  delete nitroNodeConfig.node['data-availability']['sequencer-inbox-address'];
  delete nitroNodeConfig.node['data-availability']['parent-chain-node-url'];
  nitroNodeConfig.node['data-availability']['rest-aggregator'] = {
    enable: true,
    urls: dacRestUrls,
  };
  nitroNodeConfig.node['data-availability']['rpc-aggregator'] = {
    enable: true,
    'assumed-honest': dacKeysetConfig['assumed-honest'],
    backends: JSON.stringify(
      dacKeysetConfig.backends.map((backend, index) => ({
        ...backend,
        signermask: 1 << index,
      })),
    ),
  };
}

if (nitroNodeConfig.execution?.sequencer !== undefined) {
  const sequencerConfig = nitroNodeConfig.execution.sequencer as Record<string, unknown>;
  sequencerConfig['expected-surplus-gas-price-mode'] = 'CalldataPrice';
}

await writeFile(outputFile, `${JSON.stringify(nitroNodeConfig, null, 2)}\n`);

console.log(`Nitro node config written to ${outputFile.pathname}`);
