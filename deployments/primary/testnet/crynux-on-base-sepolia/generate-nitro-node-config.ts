import { mkdir, writeFile } from 'node:fs/promises';
import { prepareChainConfig, createRollupPrepareDeploymentParamsConfig, prepareNodeConfig } from '@arbitrum/chain-sdk';
import {
  deploymentConfig,
  getBaseCrynuxTokenAddress,
  getConfiguredBatchPosterPrivateKey,
  getConfiguredValidatorPrivateKey,
  getCoreContracts,
  getDeployerAccount,
  parentChain,
  parentChainPublicClient,
  parentChainRpcUrl,
} from './common.js';

const outputDir = new URL('./nitro-node/', import.meta.url);
const publicOutputFile = new URL('./nitro-node.public.json', outputDir);
const privateOutputFile = new URL('./nitro-node.private.json', outputDir);
const parentChainLogQueryBatchSize = 1000;

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

  return publicConfig;
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

  return privateConfig;
}

const deployer = await getDeployerAccount();
const batchPosterPrivateKey = await getConfiguredBatchPosterPrivateKey();
const validatorPrivateKey = await getConfiguredValidatorPrivateKey();
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
await Promise.all([
  writeFile(publicOutputFile, `${JSON.stringify(createPublicConfig(nitroNodeConfig), null, 2)}\n`),
  writeFile(privateOutputFile, `${JSON.stringify(createPrivateConfig(nitroNodeConfig), null, 2)}\n`),
]);

console.log(`Public Nitro node config written to ${publicOutputFile.pathname}`);
console.log(`Private Nitro node config written to ${privateOutputFile.pathname}`);
