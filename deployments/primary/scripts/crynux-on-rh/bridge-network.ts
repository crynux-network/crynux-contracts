import type { JsonRpcProvider } from '@ethersproject/providers';

export async function registerCrynuxOnRhNetwork(parentChainProvider: JsonRpcProvider) {
  process.env.CRYNUX_ORBIT_TARGET = 'rh';
  const { registerOrbitNetwork } = await import('../lib/orbit/bridge-network.js');
  return registerOrbitNetwork(parentChainProvider);
}
