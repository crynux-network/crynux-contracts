import { writeFile } from 'node:fs/promises';
import { Erc20Bridger } from '@arbitrum/sdk';
import { expectPositionalArgs, getPrimaryLayerFile, primaryRuntime } from '../common.js';
import { resolveAndValidateTokenBinding } from '../lib/arbitrum/network.js';
import {
  getEthereumCrynuxTokenAddress,
  registerRobinhoodNetwork,
  robinhoodContracts,
  robinhoodPublicClient,
} from './common.js';

expectPositionalArgs(0, 'npx tsx deployments/primary/scripts/robinhood/resolve-cnx.ts');

const { network, parentProvider, childProvider } = await registerRobinhoodNetwork();
const bridger = new Erc20Bridger(network);
const ethereumCrynuxTokenAddress = getEthereumCrynuxTokenAddress();
const robinhoodCrynuxTokenAddress = await resolveAndValidateTokenBinding(
  bridger,
  ethereumCrynuxTokenAddress,
  parentProvider,
  childProvider,
);
const bytecode = await robinhoodPublicClient.getBytecode({ address: robinhoodCrynuxTokenAddress });

if (bytecode === undefined || bytecode === '0x') {
  throw new Error(`Resolved ${primaryRuntime.names.robinhood} CNX address has no deployed contract.`);
}

const updatedContracts = {
  ...robinhoodContracts,
  robinhoodCrynuxTokenAddress,
  resolvedAtBlockNumber: Number(await robinhoodPublicClient.getBlockNumber()),
};

await writeFile(
  getPrimaryLayerFile('robinhood', 'contracts.json'),
  `${JSON.stringify(updatedContracts, null, 2)}\n`,
);

console.log(`${primaryRuntime.names.robinhood} CNX token resolved:`);
console.log(JSON.stringify(updatedContracts, null, 2));
