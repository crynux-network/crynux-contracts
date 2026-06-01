import { readFile } from 'node:fs/promises';
import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from 'hardhat';

export type PrimaryConfig = {
  daoTreasuryAddress: Address | '';
  relayWalletColdAddress: Address | '';
};

export const primaryConfig = JSON.parse(await readFile(new URL('./common.json', import.meta.url), 'utf8')) as PrimaryConfig;

async function getConfiguredPrivateKey(networkName: 'ethereumSepolia' | 'baseSepolia', accountIndex: number, accountDescription: string): Promise<Hex> {
  const networkConfig = config.networks[networkName];

  if (networkConfig.type !== 'http' || !Array.isArray(networkConfig.accounts)) {
    throw new Error(`The ${networkName} network must use explicit HTTP accounts for ${accountDescription}.`);
  }

  const privateKey = networkConfig.accounts[accountIndex];

  if (privateKey === undefined) {
    throw new Error(`The ${networkName} network must define ${accountDescription}.`);
  }

  return (await privateKey.getHexString()) as Hex;
}

export function assertAddress(value: string, name: string): Address {
  if (!value.startsWith('0x') || value.length !== 42) {
    throw new Error(`${name} must be a deployed address.`);
  }

  return value as Address;
}

export function getConfiguredDeployerPrivateKey(): Promise<Hex> {
  return getConfiguredPrivateKey('ethereumSepolia', 0, 'a deployer account');
}

export function getConfiguredBatchPosterPrivateKey(): Promise<Hex> {
  return getConfiguredPrivateKey('baseSepolia', 1, 'a batch poster account');
}

export function getConfiguredValidatorPrivateKey(): Promise<Hex> {
  return getConfiguredPrivateKey('baseSepolia', 2, 'a validator account');
}

export async function getPrimaryDeployerAccount() {
  return privateKeyToAccount(await getConfiguredDeployerPrivateKey());
}
