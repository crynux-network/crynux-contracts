import { createTokenBridgeFetchTokenBridgeContracts } from '@arbitrum/chain-sdk';
import {
  getArbitrumNetworkInformationFromRollup,
  registerCustomArbitrumNetwork,
  type ArbitrumNetwork,
} from '@arbitrum/sdk';
import type { JsonRpcProvider } from '@ethersproject/providers';
import { deploymentConfig, getBaseCrynuxTokenAddress, getCoreContracts, parentChainPublicClient } from './common.js';

export async function registerCrynuxOnBaseNetwork(parentChainProvider: JsonRpcProvider): Promise<ArbitrumNetwork> {
  const coreContracts = getCoreContracts();
  const baseCrynuxTokenAddress = getBaseCrynuxTokenAddress();
  const arbitrumNetworkInformation = await getArbitrumNetworkInformationFromRollup(coreContracts.rollup, parentChainProvider);
  const tokenBridgeContracts = await createTokenBridgeFetchTokenBridgeContracts({
    inbox: coreContracts.inbox,
    parentChainPublicClient,
  });
  const arbitrumNetwork: ArbitrumNetwork = {
    name: deploymentConfig.name,
    chainId: deploymentConfig.chainId,
    parentChainId: arbitrumNetworkInformation.parentChainId,
    confirmPeriodBlocks: arbitrumNetworkInformation.confirmPeriodBlocks,
    ethBridge: arbitrumNetworkInformation.ethBridge,
    isCustom: true,
    isTestnet: true,
    nativeToken: arbitrumNetworkInformation.nativeToken,
    tokenBridge: {
      parentGatewayRouter: tokenBridgeContracts.parentChainContracts.router,
      parentErc20Gateway: tokenBridgeContracts.parentChainContracts.standardGateway,
      parentCustomGateway: tokenBridgeContracts.parentChainContracts.customGateway,
      parentWethGateway: tokenBridgeContracts.parentChainContracts.wethGateway,
      parentWeth: tokenBridgeContracts.parentChainContracts.weth,
      parentMultiCall: tokenBridgeContracts.parentChainContracts.multicall,
      childGatewayRouter: tokenBridgeContracts.orbitChainContracts.router,
      childErc20Gateway: tokenBridgeContracts.orbitChainContracts.standardGateway,
      childCustomGateway: tokenBridgeContracts.orbitChainContracts.customGateway,
      childWethGateway: tokenBridgeContracts.orbitChainContracts.wethGateway,
      childWeth: tokenBridgeContracts.orbitChainContracts.weth,
      childMultiCall: tokenBridgeContracts.orbitChainContracts.multicall,
    },
  };

  registerCustomArbitrumNetwork(arbitrumNetwork);

  if (arbitrumNetwork.nativeToken?.toLowerCase() !== baseCrynuxTokenAddress.toLowerCase()) {
    throw new Error(`Expected native token ${baseCrynuxTokenAddress}, got ${arbitrumNetwork.nativeToken ?? 'ETH'}.`);
  }

  return arbitrumNetwork;
}
