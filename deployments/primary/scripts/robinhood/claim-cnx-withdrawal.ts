import { ChildToParentMessageStatus, ChildTransactionReceipt } from '@arbitrum/sdk';
import { Wallet } from '@ethersproject/wallet';
import { expectPositionalArgs, primaryRuntime } from '../common.js';
import {
  getConfiguredDeployerPrivateKey,
  getValidatedCrynuxTokenBinding,
} from './common.js';

const [withdrawalTxHash] = expectPositionalArgs(
  1,
  'npx tsx deployments/primary/scripts/robinhood/claim-cnx-withdrawal.ts <withdrawalTxHash>',
);

if (!/^0x[0-9a-fA-F]{64}$/.test(withdrawalTxHash)) {
  throw new Error('Withdrawal transaction hash must be a 32-byte hex string.');
}

const { parentProvider, childProvider } = await getValidatedCrynuxTokenBinding();
const parentSigner = new Wallet(await getConfiguredDeployerPrivateKey(), parentProvider);
const withdrawalReceipt = await childProvider.getTransactionReceipt(withdrawalTxHash);

if (withdrawalReceipt === null) {
  throw new Error(`Withdrawal transaction ${withdrawalTxHash} was not found on ${primaryRuntime.names.robinhood}.`);
}

if (withdrawalReceipt.status !== 1) {
  throw new Error(`Withdrawal transaction ${withdrawalTxHash} did not succeed.`);
}

const childTransactionReceipt = new ChildTransactionReceipt(withdrawalReceipt);
const events = childTransactionReceipt.getChildToParentEvents();

if (events.length === 0) {
  throw new Error(`Transaction ${withdrawalTxHash} did not emit any child-to-parent messages.`);
}

const messages = await childTransactionReceipt.getChildToParentMessages(parentSigner);

console.log(`${primaryRuntime.names.robinhood} withdrawal status:`);
console.log(JSON.stringify({
  withdrawalTxHash,
  childChain: primaryRuntime.names.robinhood,
  parentChain: primaryRuntime.names.ethereum,
  childToParentMessageCount: messages.length,
}, null, 2));

for (const [index, message] of messages.entries()) {
  const status = await message.status(childProvider);
  const statusName = ChildToParentMessageStatus[status];

  if (status === ChildToParentMessageStatus.UNCONFIRMED) {
    const executableBlock = await message.getFirstExecutableBlock(childProvider);

    console.log(JSON.stringify({
      messageIndex: index,
      status: statusName,
      readyToExecute: false,
      firstExecutableParentBlock: executableBlock?.toString() ?? null,
    }, null, 2));
    continue;
  }

  if (status === ChildToParentMessageStatus.EXECUTED) {
    console.log(JSON.stringify({
      messageIndex: index,
      status: statusName,
      readyToExecute: false,
      alreadyExecuted: true,
    }, null, 2));
    continue;
  }

  const executionTransaction = await message.execute(childProvider);
  const executionReceipt = await executionTransaction.wait();

  console.log(JSON.stringify({
    messageIndex: index,
    status: 'EXECUTED',
    parentTxHash: executionReceipt.transactionHash,
  }, null, 2));
}
