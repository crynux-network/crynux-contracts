import { readFile } from 'node:fs/promises';
import { JsonRpcProvider, type Filter, type Log } from '@ethersproject/providers';
import { createPublicClient, defineChain, http, type Address, type Hex } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import type { CoreContracts } from '@arbitrum/chain-sdk';
import {
  assertAddress,
  getConfiguredDeployerPrivateKey,
  getConfiguredRpcUrl,
  getPrimaryDeployerAccount,
  getPrimaryLayerFile,
  primaryRuntime,
} from '../common.js';
import { baseContracts } from '../base/common.js';

type DacKeysetBackendConfig = {
  url: string;
  pubkey: string;
};

export type DacKeysetConfig = {
  'assumed-honest': number;
  backends: DacKeysetBackendConfig[];
};

export type GeneratedDacKeyset = {
  keyset: Hex | '';
  keysetHash: Hex | '';
};

export type CrynuxOnBaseConfig = {
  chainId: number;
  name: string;
  rpcUrl: string;
  minL2BaseFee: number;
  batchPosterAddress: Address | '';
  validatorAddress: Address | '';
  dacKeyset: DacKeysetConfig;
  generatedDacKeyset: GeneratedDacKeyset;
  dacRestUrls: string[];
  production: {
    redisPassword: string;
    publicSequencerUrl: string;
    privateRedisHost: string;
  };
  'crynux-contracts-params': {
    relayOperatorAddress: Address | '';
    creditsAdminAddress: Address | '';
    parameterWriterAddress: Address | '';
    slashReceiverAddress: Address | '';
  };
};

export type CrynuxOnBaseContracts = {
  coreContracts: CoreContracts;
  nodeContracts?: {
    credits: Address;
    benefitAddress: Address;
    delegatedStaking: Address;
    nodeStaking: Address;
    parameterController: Address;
    deployedAtBlockNumber: number;
  };
};

const configFile = getPrimaryLayerFile('crynux-on-base', 'config.json');
const contractsFile = getPrimaryLayerFile('crynux-on-base', 'contracts.json');

export const deploymentConfig = JSON.parse(await readFile(configFile, 'utf8')) as CrynuxOnBaseConfig;
export const deploymentContracts = JSON.parse(await readFile(contractsFile, 'utf8')) as CrynuxOnBaseContracts;
export const minL2BaseFee = BigInt(deploymentConfig.minL2BaseFee);
export const parentChain = primaryRuntime.isTestnet ? baseSepolia : base;
export const parentChainRpcUrl = await getConfiguredRpcUrl(primaryRuntime.hardhatNetworks.base, primaryRuntime.names.base);
export const orbitChainRpcUrl = deploymentConfig.rpcUrl;
const maxGetLogsBlockRange = 1_999;
const orbitNetworkName = primaryRuntime.isTestnet ? 'crynux-base-sepolia' : 'crynux-base';

export const orbitChain = defineChain({
  id: deploymentConfig.chainId,
  name: deploymentConfig.name,
  network: orbitNetworkName,
  nativeCurrency: {
    name: 'Crynux',
    symbol: 'CNX',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [orbitChainRpcUrl],
    },
    public: {
      http: [orbitChainRpcUrl],
    },
  },
});
export { assertAddress, getConfiguredDeployerPrivateKey };

export const parentChainPublicClient = createPublicClient({
  chain: parentChain,
  transport: http(parentChainRpcUrl),
});

export const orbitChainPublicClient = createPublicClient({
  chain: orbitChain,
  transport: http(orbitChainRpcUrl),
});

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
      const chunkToBlock = Math.min(chunkFromBlock + maxGetLogsBlockRange, toBlock);
      logs.push(
        ...(await super.getLogs({
          ...resolvedFilter,
          fromBlock: chunkFromBlock,
          toBlock: chunkToBlock,
        })),
      );
    }

    return logs;
  }

  private async resolveBlockNumber(blockTag: Filter['fromBlock']): Promise<number | null> {
    if (blockTag === undefined) {
      return null;
    }

    if (typeof blockTag === 'number') {
      return blockTag;
    }

    if (blockTag === 'latest') {
      return this.getBlockNumber();
    }

    if (blockTag === 'earliest') {
      return 0;
    }

    if (/^0x[0-9a-fA-F]+$/.test(blockTag)) {
      return Number.parseInt(blockTag, 16);
    }

    return null;
  }
}

export function createParentChainProvider(): JsonRpcProvider {
  return new ChunkedGetLogsJsonRpcProvider(parentChainRpcUrl);
}

export function createOrbitChainProvider(): JsonRpcProvider {
  return new ChunkedGetLogsJsonRpcProvider(orbitChainRpcUrl);
}

export async function getDeployerAccount() {
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

  return {
    sequencerInbox: coreContracts.sequencerInbox,
    upgradeExecutor: coreContracts.upgradeExecutor,
  };
}

export function getDacKeysetConfig(): DacKeysetConfig {
  const dacKeyset = deploymentConfig.dacKeyset;

  if (dacKeyset.backends.length === 0) {
    throw new Error('config.json must define at least one DAC backend.');
  }

  return dacKeyset;
}

export function getDacKeyset(): Hex {
  const generatedDacKeyset = deploymentConfig.generatedDacKeyset;

  if (generatedDacKeyset.keyset === '') {
    throw new Error('Run deployments/primary/scripts/crynux-on-base/generate-dac-keyset.ps1 before setting the DAC keyset.');
  }

  return generatedDacKeyset.keyset;
}

export function getBaseCrynuxTokenAddress(): Address {
  return assertAddress(baseContracts.baseCrynuxTokenAddress, 'base.contracts.baseCrynuxTokenAddress');
}
