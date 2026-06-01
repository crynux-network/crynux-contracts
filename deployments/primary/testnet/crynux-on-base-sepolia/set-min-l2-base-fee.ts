import { arbGasInfoPublicActions, arbOwnerPublicActions } from '@arbitrum/chain-sdk';
import { getDeployerAccount, minL2BaseFee, orbitChainPublicClient } from './common.js';

const deployer = await getDeployerAccount();
const orbitChainClient = orbitChainPublicClient.extend(arbGasInfoPublicActions).extend(arbOwnerPublicActions);

const currentMinL2BaseFee = await orbitChainClient.arbGasInfoReadContract({
  functionName: 'getMinimumGasPrice',
});

console.log('Current minimum L2 base fee:', currentMinL2BaseFee.toString());
console.log('Target minimum L2 base fee:', minL2BaseFee.toString());

if (currentMinL2BaseFee === minL2BaseFee) {
  console.log('Minimum L2 base fee is already configured. Skipping transaction.');
  process.exit(0);
}

const transactionRequest = await orbitChainClient.arbOwnerPrepareTransactionRequest({
  functionName: 'setMinimumL2BaseFee',
  args: [minL2BaseFee],
  upgradeExecutor: false,
  account: deployer.address,
});

const hash = await orbitChainClient.sendRawTransaction({
  serializedTransaction: await deployer.signTransaction(transactionRequest),
});
const transactionReceipt = await orbitChainClient.waitForTransactionReceipt({ hash });

console.log('Set minimum L2 base fee transaction receipt:');
console.log(JSON.stringify(transactionReceipt, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));
