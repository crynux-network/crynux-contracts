import { readFile } from 'node:fs/promises';
import { createPublicClient, http, type Address } from 'viem';
import { sepolia as ethereumSepolia } from 'viem/chains';
import { assertAddress, getPrimaryDeployerAccount } from '../../common.js';

export type EthereumConfig = {
  emission: {
    mode: number;
    startTimestamp: number;
    initialEmissionIndex: number;
    initCostCNX: number;
    fundingAmountWei: string;
  };
};

export type EthereumContracts = {
  crynuxTokenAddress: Address | '';
  emissionContractAddress: Address | '';
  deployedAtBlockNumber: number;
};

export const ethereumConfig = JSON.parse(await readFile(new URL('./config.json', import.meta.url), 'utf8')) as EthereumConfig;
export const ethereumContracts = JSON.parse(await readFile(new URL('./contracts.json', import.meta.url), 'utf8')) as EthereumContracts;
export { assertAddress };
export const ethereumRpcUrl = process.env.ETHEREUM_SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
export const ethereumPublicClient = createPublicClient({
  chain: ethereumSepolia,
  transport: http(ethereumRpcUrl),
});

export function getEthereumDeployerAccount() {
  return getPrimaryDeployerAccount();
}
