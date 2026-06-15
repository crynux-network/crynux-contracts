import { mkdir, writeFile } from 'node:fs/promises';
import { prepareChainConfig, createRollupPrepareDeploymentParamsConfig, prepareNodeConfig } from '@arbitrum/chain-sdk';
import { expectPositionalArgs, getPrimaryLayerDir } from '../common.js';
import {
  deploymentConfig,
  getBaseCrynuxTokenAddress,
  getConfiguredBatchPosterPrivateKeyPlaceholder,
  getConfiguredValidatorPrivateKeyPlaceholder,
  getCoreContracts,
  getDeployerAccount,
  parentChain,
  parentChainPublicClient,
  parentChainRpcUrl,
} from './common.js';

expectPositionalArgs(0, 'npx tsx deployments/primary/scripts/crynux-on-base/generate-nitro-node-config.ts');

const outputDir = getPrimaryLayerDir('crynux-on-base');
const nitroOutputDir = getPrimaryLayerDir('crynux-on-base') + '/nitro-node';
const publicOutputFile = `${nitroOutputDir}/nitro-node.public.json`;
const privateOutputFile = `${nitroOutputDir}/nitro-node.private.json`;
const parentChainLogQueryBatchSize = 10;
const parentChainInboxReaderBlocksToRead = 9;
const privateKeyPlaceholder = '<paste-private-key-on-target-machine>';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requireRedisPassword(): string {
  if (deploymentConfig.production.redisPassword.length === 0) {
    throw new Error('config.json must define production.redisPassword.');
  }

  return deploymentConfig.production.redisPassword;
}

function removeSequencerCoordinatorBypass(config: Record<string, unknown>) {
  const nodeConfig = config.node;
  if (!isRecord(nodeConfig)) {
    return;
  }

  const dangerousConfig = nodeConfig.dangerous;
  if (isRecord(dangerousConfig)) {
    delete dangerousConfig['no-sequencer-coordinator'];
  }
}

function configureParentChainLogQueryBatchSize(config: Record<string, unknown>) {
  const nodeConfig = config.node;
  if (!isRecord(nodeConfig)) {
    return;
  }

  const boldConfig = isRecord(nodeConfig.bold) ? nodeConfig.bold : {};
  boldConfig['max-get-log-blocks'] = parentChainLogQueryBatchSize;
  nodeConfig.bold = boldConfig;

  const stakerConfig = nodeConfig.staker;
  if (isRecord(stakerConfig)) {
    stakerConfig['log-query-batch-size'] = parentChainLogQueryBatchSize;
  }

  const inboxReaderConfig = isRecord(nodeConfig['inbox-reader']) ? nodeConfig['inbox-reader'] : {};
  inboxReaderConfig['default-blocks-to-read'] = parentChainInboxReaderBlocksToRead;
  inboxReaderConfig['max-blocks-to-read'] = parentChainInboxReaderBlocksToRead;
  nodeConfig['inbox-reader'] = inboxReaderConfig;
}

function configureDataAvailability(config: Record<string, unknown>) {
  const nodeConfig = config.node;
  if (!isRecord(nodeConfig)) {
    return;
  }

  const dataAvailabilityConfig = nodeConfig['data-availability'];
  if (!isRecord(dataAvailabilityConfig)) {
    return;
  }

  delete dataAvailabilityConfig['sequencer-inbox-address'];
  delete dataAvailabilityConfig['parent-chain-node-url'];
  dataAvailabilityConfig['rest-aggregator'] = {
    enable: true,
    urls: deploymentConfig.dacRestUrls,
  };
  dataAvailabilityConfig['rpc-aggregator'] = {
    enable: true,
    'assumed-honest': deploymentConfig.dacKeyset['assumed-honest'],
    backends: JSON.stringify(
      deploymentConfig.dacKeyset.backends.map((backend, index) => ({
        ...backend,
        signermask: 1 << index,
      })),
    ),
  };
}

function removeDebugApi(config: Record<string, unknown>) {
  const httpConfig = config.http;
  if (!isRecord(httpConfig) || !Array.isArray(httpConfig.api)) {
    return;
  }

  httpConfig.api = httpConfig.api.filter((apiName) => apiName !== 'debug');
}

function createPublicConfig(config: Record<string, unknown>) {
  const publicConfig = structuredClone(config);
  const nodeConfig = publicConfig.node;

  if (isRecord(nodeConfig)) {
    delete nodeConfig['batch-poster'];
    delete nodeConfig.staker;
    nodeConfig['seq-coordinator'] = {
      enable: true,
      'redis-url': `redis://:${requireRedisPassword()}@sequencer-redis:6488`,
      'my-url': deploymentConfig.production.publicSequencerUrl,
    };

    const dataAvailabilityConfig = nodeConfig['data-availability'];
    if (isRecord(dataAvailabilityConfig)) {
      delete dataAvailabilityConfig['rpc-aggregator'];
      delete dataAvailabilityConfig['max-batch-size'];
    }
  }

  removeSequencerCoordinatorBypass(publicConfig);
  removeDebugApi(publicConfig);

  return publicConfig;
}

function replaceOperatorPrivateKeysWithPlaceholders(config: Record<string, unknown>) {
  const nodeConfig = config.node;
  if (!isRecord(nodeConfig)) {
    return;
  }

  const batchPosterConfig = nodeConfig['batch-poster'];
  if (isRecord(batchPosterConfig) && isRecord(batchPosterConfig['parent-chain-wallet'])) {
    batchPosterConfig['parent-chain-wallet']['private-key'] = privateKeyPlaceholder;
  }

  const stakerConfig = nodeConfig.staker;
  if (isRecord(stakerConfig) && isRecord(stakerConfig['parent-chain-wallet'])) {
    stakerConfig['parent-chain-wallet']['private-key'] = privateKeyPlaceholder;
  }
}

function createPrivateConfig(config: Record<string, unknown>) {
  const privateConfig = structuredClone(config);
  const nodeConfig = privateConfig.node;

  privateConfig.http = {
    addr: '127.0.0.1',
    port: 8449,
    vhosts: ['localhost'],
    corsdomain: [],
    api: ['eth', 'net', 'web3', 'arb'],
  };

  if (isRecord(nodeConfig)) {
    delete nodeConfig.sequencer;
    delete nodeConfig['delayed-sequencer'];
    nodeConfig['seq-coordinator'] = {
      enable: true,
      'redis-url': `redis://:${requireRedisPassword()}@${deploymentConfig.production.privateRedisHost}:6488`,
    };
  }

  const executionConfig = privateConfig.execution;
  if (isRecord(executionConfig)) {
    executionConfig['forwarding-target'] = 'null';
    delete executionConfig.sequencer;
  }

  removeSequencerCoordinatorBypass(privateConfig);
  replaceOperatorPrivateKeysWithPlaceholders(privateConfig);

  return privateConfig;
}

const deployer = await getDeployerAccount();
const batchPosterPrivateKey = getConfiguredBatchPosterPrivateKeyPlaceholder();
const validatorPrivateKey = getConfiguredValidatorPrivateKeyPlaceholder();
const baseCrynuxTokenAddress = getBaseCrynuxTokenAddress();
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
const nitroNodeConfig = prepareNodeConfig({
  chainName: deploymentConfig.name,
  chainConfig,
  coreContracts: getCoreContracts(),
  batchPosterPrivateKey,
  validatorPrivateKey,
  stakeToken: createRollupConfig.stakeToken,
  parentChainId: parentChain.id,
  parentChainRpcUrl,
}) as Record<string, unknown>;

const nodeConfig = nitroNodeConfig.node;
if (isRecord(nodeConfig)) {
  const batchPosterConfig = nodeConfig['batch-poster'];
  if (isRecord(batchPosterConfig)) {
    const batchPosterMaxSize = batchPosterConfig['max-size'];
    batchPosterConfig['disable-dap-fallback-store-data-on-chain'] = true;
    delete batchPosterConfig['max-size'];

    const dataAvailabilityConfig = nodeConfig['data-availability'];
    if (batchPosterMaxSize !== undefined && isRecord(dataAvailabilityConfig)) {
      dataAvailabilityConfig['max-batch-size'] = batchPosterMaxSize;
    }
  }
}

const executionConfig = nitroNodeConfig.execution;
if (isRecord(executionConfig) && isRecord(executionConfig.sequencer)) {
  executionConfig.sequencer['expected-surplus-gas-price-mode'] = 'CalldataPrice';
}

configureDataAvailability(nitroNodeConfig);
configureParentChainLogQueryBatchSize(nitroNodeConfig);

await mkdir(outputDir, { recursive: true });
await mkdir(nitroOutputDir, { recursive: true });
await Promise.all([
  writeFile(publicOutputFile, `${JSON.stringify(createPublicConfig(nitroNodeConfig), null, 2)}\n`),
  writeFile(privateOutputFile, `${JSON.stringify(createPrivateConfig(nitroNodeConfig), null, 2)}\n`),
]);

console.log(`Public Nitro node config written to ${publicOutputFile}`);
console.log(`Private Nitro node config written to ${privateOutputFile}`);
