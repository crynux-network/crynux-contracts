import { readFile } from 'node:fs/promises';
import { createPublicClient, defineChain, http, type Address, type Hex } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import type { CoreContracts } from '@arbitrum/chain-sdk';
import {
  assertAddress,
  getConfiguredDeployerPrivateKey,
  getConfiguredBatchPosterPrivateKey as getPrimaryConfiguredBatchPosterPrivateKey,
  getConfiguredValidatorPrivateKey as getPrimaryConfiguredValidatorPrivateKey,
} from '../../common.js';
import { baseContracts } from '../base-sepolia/common.js';

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
  dacKeyset: DacKeysetConfig;
  generatedDacKeyset: GeneratedDacKeyset;
  dacRestUrls: string[];
  production: {
    redisPassword: string;
    publicSequencerUrl: string;
    privateRedisHost: string;
  };
};

export type CrynuxOnBaseContracts = {
  coreContracts: CoreContracts;
};

export const deploymentConfig = JSON.parse(await readFile(new URL('./config.json', import.meta.url), 'utf8')) as CrynuxOnBaseConfig;
export const deploymentContracts = JSON.parse(await readFile(new URL('./contracts.json', import.meta.url), 'utf8')) as CrynuxOnBaseContracts;
export const minL2BaseFee = BigInt(deploymentConfig.minL2BaseFee);
export const parentChain = baseSepolia;
export const parentChainRpcUrl = process.env.BASE_SEPOLIA_RPC_URL ?? parentChain.rpcUrls.default.http[0];
export const orbitChainRpcUrl = deploymentConfig.rpcUrl;
export const orbitChain = defineChain({
  id: deploymentConfig.chainId,
  name: deploymentConfig.name,
  network: 'crynux-base-sepolia',
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

export async function getDeployerAccount() {
  return privateKeyToAccount(await getConfiguredDeployerPrivateKey());
}

export function getConfiguredBatchPosterPrivateKey(): Promise<Hex> {
  return getPrimaryConfiguredBatchPosterPrivateKey();
}

export function getConfiguredValidatorPrivateKey(): Promise<Hex> {
  return getPrimaryConfiguredValidatorPrivateKey();
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
    throw new Error('Run deployments/primary/testnet/crynux-on-base-sepolia/generate-dac-keyset.ps1 before setting the DAC keyset.');
  }

  return generatedDacKeyset.keyset;
}

export function getBaseCrynuxTokenAddress(): Address {
  return assertAddress(baseContracts.baseCrynuxTokenAddress, 'base.contracts.baseCrynuxTokenAddress');
}
