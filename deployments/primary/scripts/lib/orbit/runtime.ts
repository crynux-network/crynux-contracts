import { readFile } from 'node:fs/promises';
import { JsonRpcProvider, type Filter, type Log } from '@ethersproject/providers';
import type { CoreContracts } from '@arbitrum/chain-sdk';
import { rhMainnet, rhTestnet } from '@arbitrum/chain-sdk/chains';
import {
  createPublicClient,
  defineChain,
  http,
  type Address,
  type Chain,
  type Hex,
} from 'viem';
import { base, baseSepolia } from 'viem/chains';
import {
  assertAddress,
  getConfiguredDeployerPrivateKey,
  getConfiguredRpcUrl,
  getPrimaryDeployerAccount,
  getPrimaryLayerDir,
  getPrimaryLayerFile,
  primaryRuntime,
} from '../../common.js';

export type DacKeysetConfig = {
  'assumed-honest': number;
  backends: Array<{ url: string; pubkey: string }>;
};

export type OrbitDeploymentConfig = {
  chainId: number;
  name: string;
  rpcUrl: string;
  minL2BaseFee: number;
  batchPosterAddress: Address | '';
  validatorAddress: Address | '';
  dacKeyset: DacKeysetConfig;
  generatedDacKeyset: { keyset: Hex | ''; keysetHash: Hex | '' };
  dacRestUrls: string[];
  production: {
    publicSequencerUrl: string;
  };
  'crynux-contracts-params': {
    relayOperatorAddress: Address | '';
    slashReceiverAddress: Address | '';
    nodeMinStakeAmount: string;
    delegatedMinStakeAmount: string;
    forceUnstakeDelay: number;
  };
};

export type OrbitDeploymentContracts = {
  coreContracts: CoreContracts;
  nodeContracts?: {
    benefitAddress: Address;
    delegatedStaking: Address;
    nodeStaking: Address;
    deployedAtBlockNumber: number;
  };
};

export type OrbitTarget = 'base' | 'rh';

export type OrbitRuntime = {
  target: OrbitTarget;
  layer: 'crynux-on-base' | 'crynux-on-rh';
  parentLayer: 'base' | 'robinhood';
  scriptDir: 'crynux-on-base' | 'crynux-on-rh';
  parentName: string;
  orbitName: string;
  orbitHardhatNetwork: string;
  parentBlockTimeSeconds: bigint;
  defaultConfirmPeriodBlocks: bigint;
  parentTokenAddress: Address | '';
  parentChain: Chain;
  parentChainRpcUrl: string;
  orbitChainRpcUrl: string;
  deploymentConfig: OrbitDeploymentConfig;
  deploymentContracts: OrbitDeploymentContracts;
};

const target = process.env.CRYNUX_ORBIT_TARGET;
if (target !== 'base' && target !== 'rh') {
  throw new Error('CRYNUX_ORBIT_TARGET must be set by a chain-specific Orbit command entry.');
}

const layer = target === 'base' ? 'crynux-on-base' : 'crynux-on-rh';
const parentLayer = target === 'base' ? 'base' : 'robinhood';
const configFile = getPrimaryLayerFile(layer as Parameters<typeof getPrimaryLayerFile>[0], 'config.json');
const contractsFile = getPrimaryLayerFile(layer as Parameters<typeof getPrimaryLayerFile>[0], 'contracts.json');
const deploymentConfig = JSON.parse(await readFile(configFile, 'utf8')) as OrbitDeploymentConfig;
const deploymentContracts = JSON.parse(await readFile(contractsFile, 'utf8')) as OrbitDeploymentContracts;
const parentName = target === 'base' ? primaryRuntime.names.base : primaryRuntime.names.robinhood;
const orbitName = target === 'base' ? primaryRuntime.names.crynuxOnBase : primaryRuntime.names.crynuxOnRh;
const parentHardhatNetwork =
  target === 'base' ? primaryRuntime.hardhatNetworks.base : primaryRuntime.hardhatNetworks.robinhood;
const orbitHardhatNetwork =
  target === 'base' ? primaryRuntime.hardhatNetworks.crynuxOnBase : primaryRuntime.hardhatNetworks.crynuxOnRh;
const configuredParentChainRpcUrl = await getConfiguredRpcUrl(parentHardhatNetwork, parentName);
const parentChain =
  target === 'base'
    ? primaryRuntime.isTestnet
      ? baseSepolia
      : base
    : primaryRuntime.isTestnet
      ? rhTestnet
      : rhMainnet;
const parentContractsFile = getPrimaryLayerFile(
  parentLayer as Parameters<typeof getPrimaryLayerFile>[0],
  'contracts.json',
);
const parentContracts = JSON.parse(await readFile(parentContractsFile, 'utf8')) as Record<string, unknown>;
const parentTokenAddress = String(
  target === 'base'
    ? parentContracts.baseCrynuxTokenAddress ?? ''
    : parentContracts.robinhoodCrynuxTokenAddress ?? '',
) as Address | '';
const parentBlockTimeSeconds = target === 'base' ? 2n : 12n;
const confirmPeriodSeconds = primaryRuntime.isTestnet ? 30n * 60n : 24n * 60n * 60n;

export const orbitRuntime: OrbitRuntime = {
  target,
  layer,
  parentLayer,
  scriptDir: layer,
  parentName,
  orbitName,
  orbitHardhatNetwork,
  parentTokenAddress,
  parentChain,
  parentChainRpcUrl: configuredParentChainRpcUrl,
  orbitChainRpcUrl: deploymentConfig.rpcUrl,
  deploymentConfig,
  deploymentContracts,
  parentBlockTimeSeconds,
  defaultConfirmPeriodBlocks: confirmPeriodSeconds / parentBlockTimeSeconds,
};

export { assertAddress, deploymentConfig, deploymentContracts, getConfiguredDeployerPrivateKey, parentChain };
export const minL2BaseFee = BigInt(deploymentConfig.minL2BaseFee);
export const parentChainRpcUrl = orbitRuntime.parentChainRpcUrl;
export const orbitChainRpcUrl = orbitRuntime.orbitChainRpcUrl;
export const orbitChain = defineChain({
  id: deploymentConfig.chainId,
  name: deploymentConfig.name,
  network: primaryRuntime.isTestnet ? `${layer}-testnet` : layer,
  nativeCurrency: { name: 'Crynux', symbol: 'CNX', decimals: 18 },
  rpcUrls: {
    default: { http: [orbitChainRpcUrl] },
    public: { http: [orbitChainRpcUrl] },
  },
});

export const parentChainPublicClient = createPublicClient({
  chain: parentChain,
  transport: http(parentChainRpcUrl),
});
export const orbitChainPublicClient = createPublicClient({
  chain: orbitChain,
  transport: http(orbitChainRpcUrl),
});

const maxGetLogsBlockRange = 1_999;

class ChunkedGetLogsJsonRpcProvider extends JsonRpcProvider {
  async getLogs(filter: Filter | Promise<Filter>): Promise<Log[]> {
    const resolvedFilter = await filter;
    const fromBlock = await this.resolveBlockNumber(resolvedFilter.fromBlock);
    const toBlock = await this.resolveBlockNumber(resolvedFilter.toBlock);

    if (fromBlock === null || toBlock === null || toBlock - fromBlock <= maxGetLogsBlockRange) {
      return super.getLogs(resolvedFilter);
    }

    const logs: Log[] = [];
    for (let chunkFromBlock = fromBlock; chunkFromBlock <= toBlock; chunkFromBlock += maxGetLogsBlockRange + 1) {
      logs.push(
        ...(await super.getLogs({
          ...resolvedFilter,
          fromBlock: chunkFromBlock,
          toBlock: Math.min(chunkFromBlock + maxGetLogsBlockRange, toBlock),
        })),
      );
    }
    return logs;
  }

  private async resolveBlockNumber(blockTag: Filter['fromBlock']): Promise<number | null> {
    if (blockTag === undefined) return null;
    if (typeof blockTag === 'number') return blockTag;
    if (blockTag === 'latest') return this.getBlockNumber();
    if (blockTag === 'earliest') return 0;
    if (/^0x[0-9a-fA-F]+$/.test(blockTag)) return Number.parseInt(blockTag, 16);
    return null;
  }
}

export function createParentChainProvider(): JsonRpcProvider {
  return new ChunkedGetLogsJsonRpcProvider(parentChainRpcUrl);
}

export function createOrbitChainProvider(): JsonRpcProvider {
  return new ChunkedGetLogsJsonRpcProvider(orbitChainRpcUrl);
}

export function getDeployerAccount() {
  return getPrimaryDeployerAccount();
}

export function getBatchPosterAddress(): Address {
  return assertAddress(deploymentConfig.batchPosterAddress, 'config.batchPosterAddress');
}

export function getValidatorAddress(): Address {
  return assertAddress(deploymentConfig.validatorAddress, 'config.validatorAddress');
}

export function getConfiguredBatchPosterPrivateKeyPlaceholder(): Hex {
  return `0x${'11'.repeat(32)}`;
}

export function getConfiguredValidatorPrivateKeyPlaceholder(): Hex {
  return `0x${'22'.repeat(32)}`;
}

export function getCoreContracts(): CoreContracts {
  const coreContracts = deploymentContracts.coreContracts;
  assertAddress(coreContracts.rollup, 'contracts.coreContracts.rollup');
  assertAddress(coreContracts.inbox, 'contracts.coreContracts.inbox');
  assertAddress(coreContracts.sequencerInbox, 'contracts.coreContracts.sequencerInbox');
  assertAddress(coreContracts.outbox, 'contracts.coreContracts.outbox');
  assertAddress(coreContracts.bridge, 'contracts.coreContracts.bridge');
  assertAddress(coreContracts.upgradeExecutor, 'contracts.coreContracts.upgradeExecutor');
  return coreContracts;
}

export function getDacCoreContracts(): Pick<CoreContracts, 'sequencerInbox' | 'upgradeExecutor'> {
  const coreContracts = getCoreContracts();
  return { sequencerInbox: coreContracts.sequencerInbox, upgradeExecutor: coreContracts.upgradeExecutor };
}

export function getDacKeysetConfig(): DacKeysetConfig {
  if (deploymentConfig.dacKeyset.backends.length === 0) {
    throw new Error('config.json must define at least one DAC backend.');
  }
  const missingFields = deploymentConfig.dacKeyset.backends.flatMap((backend, index) => [
    ...(backend.url.length === 0 ? [`dacKeyset.backends[${index}].url`] : []),
    ...(backend.pubkey.length === 0 ? [`dacKeyset.backends[${index}].pubkey`] : []),
  ]);
  if (missingFields.length > 0) {
    throw new Error(`config.json must define: ${missingFields.join(', ')}.`);
  }
  return deploymentConfig.dacKeyset;
}

export function getDacKeyset(): Hex {
  const keyset = deploymentConfig.generatedDacKeyset.keyset;
  if (keyset === '') {
    throw new Error(`Run deployments/primary/scripts/${layer}/generate-dac-keyset.ps1 before setting the DAC keyset.`);
  }
  return keyset;
}

export function getParentCrynuxTokenAddress(): Address {
  return assertAddress(
    parentTokenAddress,
    `${parentLayer}.contracts.${target === 'base' ? 'baseCrynuxTokenAddress' : 'robinhoodCrynuxTokenAddress'}`,
  );
}

export function getOrbitLayerDir(): string {
  return getPrimaryLayerDir(layer as Parameters<typeof getPrimaryLayerDir>[0]);
}

export function getOrbitLayerFile(...relativePaths: string[]): string {
  return getPrimaryLayerFile(layer as Parameters<typeof getPrimaryLayerFile>[0], ...relativePaths);
}

export function orbitUsage(fileName: string, args = ''): string {
  return `npx tsx deployments/primary/scripts/${layer}/${fileName}${args.length === 0 ? '' : ` ${args}`}`;
}
