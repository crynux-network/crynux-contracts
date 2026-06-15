import { readFile } from 'node:fs/promises';
import { createPublicClient, http, type Address } from 'viem';
import { mainnet as ethereumMainnet, sepolia as ethereumSepolia } from 'viem/chains';
import {
  assertAddress,
  getConfiguredRpcUrl,
  getPrimaryDeployerAccount,
  getPrimaryLayerFile,
  primaryRuntime,
} from '../common.js';

export type EthereumConfig = {
  emission: {
    mode: number;
    startTimestamp: number;
    initialEmissionIndex: number;
    initCostCNX: number;
  };
};

export type EthereumContracts = {
  crynuxTokenAddress: Address | '';
  emissionContractAddress: Address | '';
  deployedAtBlockNumber: number;
};

const chain = primaryRuntime.isTestnet ? ethereumSepolia : ethereumMainnet;
const configFile = getPrimaryLayerFile('ethereum', 'config.json');
const contractsFile = getPrimaryLayerFile('ethereum', 'contracts.json');

export const ethereumConfig = JSON.parse(await readFile(configFile, 'utf8')) as EthereumConfig;
export const ethereumContracts = JSON.parse(await readFile(contractsFile, 'utf8')) as EthereumContracts;
export const ethereumRpcUrl = await getConfiguredRpcUrl(
  primaryRuntime.hardhatNetworks.ethereum,
  primaryRuntime.names.ethereum,
);
export const ethereumPublicClient = createPublicClient({
  chain,
  transport: http(ethereumRpcUrl),
});
export { assertAddress };

export function getEthereumDeployerAccount() {
  return getPrimaryDeployerAccount();
}
