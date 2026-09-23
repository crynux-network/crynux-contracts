import { mkdir, writeFile } from 'node:fs/promises';
import { prepareChainConfig, createRollupPrepareDeploymentParamsConfig, prepareNodeConfig } from '@arbitrum/chain-sdk';
import { expectPositionalArgs } from '../../common.js';
import { orbitRuntime, getOrbitLayerDir, deploymentConfig, getParentCrynuxTokenAddress, getConfiguredBatchPosterPrivateKeyPlaceholder, getConfiguredValidatorPrivateKeyPlaceholder, getCoreContracts, getDacKeysetConfig, getDeployerAccount, parentChain, parentChainPublicClient, parentChainRpcUrl } from './runtime.js';

expectPositionalArgs(0, `npx tsx deployments/primary/scripts/${orbitRuntime.scriptDir}/generate-nitro-node-config.ts`);

const outputDir = getOrbitLayerDir();
const nitroOutputDir = getOrbitLayerDir() + '/nitro-node';
const publicOutputFile = `${nitroOutputDir}/nitro-node.public.json`;
const privateOutputFile = `${nitroOutputDir}/nitro-node.private.json`;
const parentChainLogQueryBatchSize = 1_000;
const parentChainInboxReaderDefaultBlocksToRead = 100;
const parentChainInboxReaderMaxBlocksToRead = 1_000;
const privateKeyPlaceholder = '<paste-private-key-on-target-machine>';
const redisPasswordPlaceholder = '<paste-redis-password-on-target-machine>';
const privateRedisHostPlaceholder = '<paste-private-redis-host-on-target-machine>';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validateNodeConfiguration(): void {
  const missingFields = [
    ...(deploymentConfig.production.publicSequencerUrl.length === 0
      ? ['production.publicSequencerUrl']
      : []),
    ...(deploymentConfig.dacRestUrls.length === 0
      || deploymentConfig.dacRestUrls.some((url) => url.length === 0)
      ? ['dacRestUrls']
      : []),
  ];
  if (missingFields.length > 0) {
    throw new Error(`config.json must define: ${missingFields.join(', ')}.`);
  }
  getDacKeysetConfig();
}

function configureDangerousOptions(config: Record<string, unknown>) {
  const nodeConfig = config.node;
  if (!isRecord(nodeConfig)) {
    return;
  }

  const dangerousConfig = nodeConfig.dangerous;
  if (isRecord(dangerousConfig)) {
    dangerousConfig['disable-blob-reader'] = true;
    delete dangerousConfig['no-sequencer-coordinator'];
  }
}

function configureParentChainReader(config: Record<string, unknown>) {
  const nodeConfig = config.node;
  if (!isRecord(nodeConfig)) {
    return;
  }

  const boldConfig = isRecord(nodeConfig.bold) ? nodeConfig.bold : {};
  boldConfig['max-get-log-blocks'] = parentChainLogQueryBatchSize;
  boldConfig['parent-chain-block-time'] = `${orbitRuntime.parentBlockTimeSeconds.toString()}s`;
  nodeConfig.bold = boldConfig;

  const stakerConfig = nodeConfig.staker;
  if (isRecord(stakerConfig)) {
    stakerConfig['log-query-batch-size'] = parentChainLogQueryBatchSize;
  }

  const inboxReaderConfig = isRecord(nodeConfig['inbox-reader']) ? nodeConfig['inbox-reader'] : {};
  inboxReaderConfig['default-blocks-to-read'] = parentChainInboxReaderDefaultBlocksToRead;
  inboxReaderConfig['max-blocks-to-read'] = parentChainInboxReaderMaxBlocksToRead;
  nodeConfig['inbox-reader'] = inboxReaderConfig;

  const executionConfig = config.execution;
  if (isRecord(executionConfig)) {
    executionConfig['parent-chain-reader'] = {
      'poll-interval': '1m',
      'poll-timeout': '10s',
    };
  }
}

function getAnyTrustConfig(nodeConfig: Record<string, unknown>): Record<string, unknown> | undefined {
  const daConfig = nodeConfig.da;
  if (isRecord(daConfig) && isRecord(daConfig.anytrust)) {
    return daConfig.anytrust;
  }

  const legacyConfig = nodeConfig['data-availability'];
  return isRecord(legacyConfig) ? legacyConfig : undefined;
}

function configureDataAvailability(config: Record<string, unknown>) {
  const nodeConfig = config.node;
  if (!isRecord(nodeConfig)) {
    return;
  }

  const dataAvailabilityConfig = getAnyTrustConfig(nodeConfig);
  if (dataAvailabilityConfig === undefined) {
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

  publicConfig.ws = {
    addr: '0.0.0.0',
    port: 8448,
    origins: ['*'],
  };

  if (isRecord(nodeConfig)) {
    delete nodeConfig['batch-poster'];
    delete nodeConfig.staker;
    nodeConfig['seq-coordinator'] = {
      enable: true,
      'redis-url': `redis://:${redisPasswordPlaceholder}@sequencer-redis:6488`,
      'my-url': deploymentConfig.production.publicSequencerUrl,
    };
    const feedConfig = isRecord(nodeConfig.feed) ? nodeConfig.feed : {};
    feedConfig.output = {
      addr: '0.0.0.0',
      enable: true,
      port: 9642,
    };
    nodeConfig.feed = feedConfig;

    const dataAvailabilityConfig = getAnyTrustConfig(nodeConfig);
    if (dataAvailabilityConfig !== undefined) {
      delete dataAvailabilityConfig['rpc-aggregator'];
      delete dataAvailabilityConfig['max-batch-size'];
    }
  }

  const executionConfig = publicConfig.execution;
  if (
    isRecord(executionConfig)
    && isRecord(executionConfig.sequencer)
  ) {
    executionConfig.sequencer['max-block-speed'] = '5s';
  }

  configureDangerousOptions(publicConfig);
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
      'redis-url': `redis://:${redisPasswordPlaceholder}@${privateRedisHostPlaceholder}:6488`,
    };
  }

  const executionConfig = privateConfig.execution;
  if (isRecord(executionConfig)) {
    executionConfig['forwarding-target'] = 'null';
    delete executionConfig.sequencer;
  }

  configureDangerousOptions(privateConfig);
  replaceOperatorPrivateKeysWithPlaceholders(privateConfig);

  return privateConfig;
}

const deployer = await getDeployerAccount();
validateNodeConfiguration();
const batchPosterPrivateKey = getConfiguredBatchPosterPrivateKeyPlaceholder();
const validatorPrivateKey = getConfiguredValidatorPrivateKeyPlaceholder();
const parentCrynuxTokenAddress = getParentCrynuxTokenAddress();
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
    batchPosterConfig['disable-dap-fallback-store-data-on-chain'] = true;
    delete batchPosterConfig['max-size'];
  }
}

const executionConfig = nitroNodeConfig.execution;
if (isRecord(executionConfig) && isRecord(executionConfig.sequencer)) {
  executionConfig.sequencer['expected-surplus-gas-price-mode'] = 'CalldataPrice';
}

configureDataAvailability(nitroNodeConfig);
configureParentChainReader(nitroNodeConfig);

await mkdir(outputDir, { recursive: true });
await mkdir(nitroOutputDir, { recursive: true });
await Promise.all([
  writeFile(publicOutputFile, `${JSON.stringify(createPublicConfig(nitroNodeConfig), null, 2)}\n`),
  writeFile(privateOutputFile, `${JSON.stringify(createPrivateConfig(nitroNodeConfig), null, 2)}\n`),
]);

console.log(`Public Nitro node config written to ${publicOutputFile}`);
console.log(`Private Nitro node config written to ${privateOutputFile}`);
