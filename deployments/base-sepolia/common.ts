import { createPublicClient, http, type Address, type Hex } from 'viem';
import { baseSepolia } from 'viem/chains';
import { config } from 'hardhat';
import { privateKeyToAccount } from 'viem/accounts';
import { createRequire } from 'node:module';
import type { CoreContracts } from '@arbitrum/chain-sdk';

type DacKeysetBackendConfig = {
  url: string;
  pubkey: string;
};

export type DacKeysetConfig = {
  'assumed-honest': number;
  backends: DacKeysetBackendConfig[];
};

type DeploymentConfig = {
  l1CrynuxTokenAddress: Address;
  l2ChainId: number;
  l2BatchPosterAddress: Address;
  l2ValidatorAddress: Address;
  dacKeyset?: DacKeysetConfig;
  dacRestUrls?: string[];
  coreContracts?: CoreContracts;
};

type GeneratedDacKeyset = {
  keyset: Hex;
  keysetHash: Hex;
};

const require = createRequire(import.meta.url);

export const deploymentConfig = require('./config.json') as DeploymentConfig;
export const parentChain = baseSepolia;
export const parentChainRpcUrl = process.env.BASE_SEPOLIA_RPC_URL ?? parentChain.rpcUrls.default.http[0];

export const parentChainPublicClient = createPublicClient({
  chain: parentChain,
  transport: http(parentChainRpcUrl),
});

async function getConfiguredBaseSepoliaPrivateKey(accountIndex: number, accountDescription: string): Promise<Hex> {
  const networkConfig = config.networks.baseSepolia;

  if (networkConfig.type !== 'http' || !Array.isArray(networkConfig.accounts)) {
    throw new Error(`The baseSepolia network must use explicit HTTP accounts for ${accountDescription}.`);
  }

  const privateKey = networkConfig.accounts[accountIndex];

  if (privateKey === undefined) {
    throw new Error(`The baseSepolia network must define ${accountDescription}.`);
  }

  return (await privateKey.getHexString()) as Hex;
}

export async function getConfiguredRollupDeployerPrivateKey(): Promise<Hex> {
  return getConfiguredBaseSepoliaPrivateKey(0, 'a rollup deployer account');
}

export async function getConfiguredBatchPosterPrivateKey(): Promise<Hex> {
  return getConfiguredBaseSepoliaPrivateKey(1, 'a batch poster account');
}

export async function getConfiguredValidatorPrivateKey(): Promise<Hex> {
  return getConfiguredBaseSepoliaPrivateKey(2, 'a validator account');
}

export async function getRollupDeployerAccount() {
  return privateKeyToAccount(await getConfiguredRollupDeployerPrivateKey());
}

export function getDacCoreContracts(): Pick<CoreContracts, 'sequencerInbox' | 'upgradeExecutor'> {
  if (deploymentConfig.coreContracts === undefined) {
    throw new Error('config.json must define coreContracts.sequencerInbox and coreContracts.upgradeExecutor.');
  }

  return deploymentConfig.coreContracts;
}

export function getCoreContracts(): CoreContracts {
  if (deploymentConfig.coreContracts === undefined) {
    throw new Error('config.json must define coreContracts.');
  }

  return deploymentConfig.coreContracts;
}

export function getDacKeysetConfig(): DacKeysetConfig {
  if (deploymentConfig.dacKeyset === undefined) {
    throw new Error('config.json must define dacKeyset.');
  }

  return deploymentConfig.dacKeyset;
}

export function getDacRestUrls(): string[] {
  if (deploymentConfig.dacRestUrls === undefined || deploymentConfig.dacRestUrls.length === 0) {
    throw new Error('config.json must define dacRestUrls.');
  }

  return deploymentConfig.dacRestUrls;
}

export function getDacKeyset(): Hex {
  let generatedDacKeyset: GeneratedDacKeyset;

  try {
    generatedDacKeyset = require('./dac-keyset.json') as GeneratedDacKeyset;
  } catch {
    throw new Error('Run deployments/base-sepolia/generate-dac-keyset.ps1 before setting the DAC keyset.');
  }

  return generatedDacKeyset.keyset;
}
