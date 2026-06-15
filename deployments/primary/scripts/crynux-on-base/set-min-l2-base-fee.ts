import { arbGasInfoPublicActions, arbOwnerPublicActions } from '@arbitrum/chain-sdk';
import { expectAtLeastPositionalArgs } from '../common.js';
import { getDeployerAccount, minL2BaseFee, orbitChainPublicClient } from './common.js';

const [targetMinL2BaseFeeInput, transactionMaxFeePerGasInput, ...extraArgs] = expectAtLeastPositionalArgs(
  0,
  'npx tsx deployments/primary/scripts/crynux-on-base/set-min-l2-base-fee.ts [targetMinL2BaseFeeWei] [transactionMaxFeePerGasWei]',
);

if (extraArgs.length > 0) {
  throw new Error(
    'Usage: npx tsx deployments/primary/scripts/crynux-on-base/set-min-l2-base-fee.ts [targetMinL2BaseFeeWei] [transactionMaxFeePerGasWei] --network=<testnet|mainnet>',
  );
}

function parseTargetMinL2BaseFee(value: string | undefined): bigint {
  if (value === undefined) {
    return minL2BaseFee;
  }

  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error('targetMinL2BaseFeeWei must be a positive integer in wei.');
  }

  return BigInt(value);
}

function parseOptionalTransactionMaxFeePerGas(value: string | undefined): bigint | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error('transactionMaxFeePerGasWei must be a positive integer in wei.');
  }

  return BigInt(value);
}

const deployer = await getDeployerAccount();
const orbitChainClient = orbitChainPublicClient.extend(arbGasInfoPublicActions).extend(arbOwnerPublicActions);
const targetMinL2BaseFee = parseTargetMinL2BaseFee(targetMinL2BaseFeeInput);
const transactionMaxFeePerGas = parseOptionalTransactionMaxFeePerGas(transactionMaxFeePerGasInput);

const currentMinL2BaseFee = await orbitChainClient.arbGasInfoReadContract({
  functionName: 'getMinimumGasPrice',
});
const currentGasPrices = await orbitChainClient.arbGasInfoReadContract({
  functionName: 'getPricesInWei',
});
const currentL2BaseFee = currentGasPrices[5];

console.log('Current minimum L2 base fee:', currentMinL2BaseFee.toString());
console.log('Current L2 base fee:', currentL2BaseFee.toString());
console.log('Target minimum L2 base fee:', targetMinL2BaseFee.toString());
console.log('Transaction max fee per gas override:', transactionMaxFeePerGas?.toString() ?? 'network default');

async function sendArbOwnerTransaction(functionName: 'setMinimumL2BaseFee' | 'setL2BaseFee', priceInWei: bigint) {
  const transactionRequest = await orbitChainClient.arbOwnerPrepareTransactionRequest({
    functionName,
    args: [priceInWei],
    upgradeExecutor: false,
    account: deployer.address,
  });

  const transactionToSign = transactionMaxFeePerGas === undefined
    ? transactionRequest
    : {
        ...transactionRequest,
        gasPrice: undefined,
        maxFeePerGas: transactionMaxFeePerGas,
        maxPriorityFeePerGas:
          transactionRequest.maxPriorityFeePerGas !== undefined && transactionRequest.maxPriorityFeePerGas <= transactionMaxFeePerGas
            ? transactionRequest.maxPriorityFeePerGas
            : BigInt(0),
      };

  const hash = await orbitChainClient.sendRawTransaction({
    serializedTransaction: await deployer.signTransaction(transactionToSign),
  });
  return orbitChainClient.waitForTransactionReceipt({ hash });
}

if (currentMinL2BaseFee === targetMinL2BaseFee) {
  console.log('Minimum L2 base fee is already configured. Skipping minimum base fee transaction.');
} else {
  const transactionReceipt = await sendArbOwnerTransaction('setMinimumL2BaseFee', targetMinL2BaseFee);

  console.log('Set minimum L2 base fee transaction receipt:');
  console.log(JSON.stringify(transactionReceipt, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));
}

if (currentL2BaseFee >= targetMinL2BaseFee) {
  console.log('Current L2 base fee is already at or above the target minimum. Skipping current base fee transaction.');
} else {
  const transactionReceipt = await sendArbOwnerTransaction('setL2BaseFee', targetMinL2BaseFee);

  console.log('Set current L2 base fee transaction receipt:');
  console.log(JSON.stringify(transactionReceipt, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));
}
