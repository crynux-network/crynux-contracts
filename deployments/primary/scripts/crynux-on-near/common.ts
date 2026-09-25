import { readFile } from 'node:fs/promises';
import { createPublicClient, defineChain, http, type Address } from 'viem';
import {
  assertAddress,
  getPrimaryLayerFile,
  primaryRuntime,
} from '../common.js';

export type CrynuxOnNearConfig = {
  chainId: number;
  name: string;
  slug: string;
  rpcUrl: string;
  'crynux-contracts-params': {
    relayOperatorAddress: Address | '';
    slashReceiverAddress: Address | '';
    nodeMinStakeAmount: string;
    delegatedMinStakeAmount: string;
    forceUnstakeDelay: number;
  };
};

export type CrynuxOnNearContracts = {
  nodeContracts?: {
    benefitAddress: Address;
    delegatedStaking: Address;
    nodeStaking: Address;
    deployedAtBlockNumber: number;
  };
};

if (primaryRuntime.isTestnet) {
  throw new Error('Crynux on Near node-contract scripts support --network=mainnet only.');
}

const configFile = getPrimaryLayerFile('crynux-on-near', 'config.json');
const contractsFile = getPrimaryLayerFile('crynux-on-near', 'contracts.json');

export const crynuxOnNearConfig = JSON.parse(await readFile(configFile, 'utf8')) as CrynuxOnNearConfig;
export const crynuxOnNearContracts = JSON.parse(await readFile(contractsFile, 'utf8')) as CrynuxOnNearContracts;

if (crynuxOnNearConfig.chainId !== 1313161911) {
  throw new Error(`Crynux on Near config chainId must be 1313161911. Found ${crynuxOnNearConfig.chainId}.`);
}

if (typeof crynuxOnNearConfig.name !== 'string' || crynuxOnNearConfig.name.trim() === '') {
  throw new Error('crynux-on-near config name must be a non-empty string.');
}

if (crynuxOnNearConfig.slug !== 'crynux-on-near') {
  throw new Error(`crynux-on-near config slug must be crynux-on-near. Found ${crynuxOnNearConfig.slug}.`);
}

if (typeof crynuxOnNearConfig.rpcUrl !== 'string' || !crynuxOnNearConfig.rpcUrl.startsWith('http')) {
  throw new Error('crynux-on-near config rpcUrl must be an HTTP(S) URL.');
}

export const crynuxOnNearChain = defineChain({
  id: crynuxOnNearConfig.chainId,
  name: crynuxOnNearConfig.name,
  nativeCurrency: {
    name: 'Crynux',
    symbol: 'CNX',
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [crynuxOnNearConfig.rpcUrl] },
    public: { http: [crynuxOnNearConfig.rpcUrl] },
  },
});

export const crynuxOnNearPublicClient = createPublicClient({
  chain: crynuxOnNearChain,
  transport: http(crynuxOnNearConfig.rpcUrl),
});

export function getCrynuxOnNearContractsFile(): string {
  return contractsFile;
}

export { assertAddress };
