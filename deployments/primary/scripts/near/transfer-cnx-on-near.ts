import { parseUnits } from 'viem';
import { primaryRuntime } from '../common.js';
import {
  bridgedCrynuxToken,
  formatCnxAmount,
  getConfiguredNearDeployerAccountId,
  getNearCrynuxTokenAccountId,
  getNearTokenBalance,
  sendNearBridgeTransaction,
  tryViewNearFunction,
  viewNearFunction,
} from './common.js';

type StorageBalance = {
  total: string;
  available: string;
};

type StorageBalanceBounds = {
  min: string;
  max: string | null;
};

const transferConfirmationWaitMs = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTransferArgs(): { amount: bigint; recipientAccountId: string } {
  if (primaryRuntime.optionArgs.length > 0) {
    throw new Error(`Unsupported option: ${primaryRuntime.optionArgs[0]}.`);
  }

  if (primaryRuntime.positionalArgs.length !== 2) {
    throw new Error('Usage: npx tsx deployments/primary/scripts/near/transfer-cnx-on-near.ts <integer-cnx-amount> <near-recipient-account-id> --network=<testnet|mainnet>');
  }

  const [amountArg, recipientAccountId] = primaryRuntime.positionalArgs as [string, string];

  if (!/^[1-9]\d*$/.test(amountArg)) {
    throw new Error('The CNX amount must be a positive integer.');
  }

  if (!/^[a-z0-9._-]+$/.test(recipientAccountId)) {
    throw new Error('The NEAR recipient account ID contains unsupported characters.');
  }

  return {
    amount: parseUnits(amountArg, bridgedCrynuxToken.decimals),
    recipientAccountId,
  };
}

async function ensureRecipientStorageDeposit(tokenAccountId: string, recipientAccountId: string): Promise<string | undefined> {
  const storageBalance = await tryViewNearFunction<StorageBalance | null>(tokenAccountId, 'storage_balance_of', {
    account_id: recipientAccountId,
  });

  if (storageBalance !== undefined && storageBalance !== null) {
    console.log(`${recipientAccountId} is already registered for ${tokenAccountId} storage.`);
    return undefined;
  }

  const storageBounds = await viewNearFunction<StorageBalanceBounds>(tokenAccountId, 'storage_balance_bounds', {});
  const storageDepositAmount = BigInt(storageBounds.min);
  const signerAccountId = getConfiguredNearDeployerAccountId();
  const storageDepositReceipt = await sendNearBridgeTransaction({
    type: 'near',
    signerId: signerAccountId,
    receiverId: tokenAccountId,
    actions: [{
      type: 'FunctionCall',
      methodName: 'storage_deposit',
      args: new TextEncoder().encode(JSON.stringify({ account_id: recipientAccountId })),
      gas: 10_000_000_000_000n,
      deposit: storageDepositAmount,
    }],
  });

  console.log(`${primaryRuntime.names.near} storage_deposit transaction succeeded: ${storageDepositReceipt.transaction.hash}.`);

  return storageDepositReceipt.transaction.hash;
}

const { amount, recipientAccountId } = getTransferArgs();
const senderAccountId = getConfiguredNearDeployerAccountId();
const tokenAccountId = getNearCrynuxTokenAccountId();
const senderInitialBalance = await getNearTokenBalance(tokenAccountId, senderAccountId);
const recipientInitialBalance = await getNearTokenBalance(tokenAccountId, recipientAccountId);

if (senderInitialBalance < amount) {
  throw new Error(`Insufficient ${senderAccountId} CNX balance. Required ${formatCnxAmount(amount)}, available ${formatCnxAmount(senderInitialBalance)}.`);
}

console.log(`${primaryRuntime.names.near} CNX transfer:`);
console.log(JSON.stringify({
  tokenAccountId,
  senderAccountId,
  recipientAccountId,
  amount: `${formatCnxAmount(amount)} CNX`,
  senderInitialBalance: `${formatCnxAmount(senderInitialBalance)} CNX`,
  recipientInitialBalance: `${formatCnxAmount(recipientInitialBalance)} CNX`,
}, null, 2));

const storageDepositHash = await ensureRecipientStorageDeposit(tokenAccountId, recipientAccountId);
const transferReceipt = await sendNearBridgeTransaction({
  type: 'near',
  signerId: senderAccountId,
  receiverId: tokenAccountId,
  actions: [{
    type: 'FunctionCall',
    methodName: 'ft_transfer',
    args: new TextEncoder().encode(JSON.stringify({
      receiver_id: recipientAccountId,
      amount: amount.toString(),
      memo: null,
    })),
    gas: 30_000_000_000_000n,
    deposit: 1n,
  }],
});

console.log(`${primaryRuntime.names.near} ft_transfer transaction succeeded: ${transferReceipt.transaction.hash}.`);
console.log(`Waiting ${transferConfirmationWaitMs / 1000} seconds before verifying the recipient balance.`);
await sleep(transferConfirmationWaitMs);

const recipientFinalBalance = await getNearTokenBalance(tokenAccountId, recipientAccountId);
const minimumExpectedRecipientBalance = recipientInitialBalance + amount;

if (recipientFinalBalance < minimumExpectedRecipientBalance) {
  throw new Error(
    `${primaryRuntime.names.near} recipient balance did not increase by the expected amount. ` +
    `Initial balance: ${formatCnxAmount(recipientInitialBalance)} CNX; ` +
    `expected received: ${formatCnxAmount(amount)} CNX; ` +
    `final balance: ${formatCnxAmount(recipientFinalBalance)} CNX.`,
  );
}

console.log(`${primaryRuntime.names.near} CNX transfer verified:`);
console.log(JSON.stringify({
  tokenAccountId,
  senderAccountId,
  recipientAccountId,
  storageDepositHash,
  transferHash: transferReceipt.transaction.hash,
  recipientInitialBalance: `${formatCnxAmount(recipientInitialBalance)} CNX`,
  transferredAmount: `${formatCnxAmount(amount)} CNX`,
  recipientFinalBalance: `${formatCnxAmount(recipientFinalBalance)} CNX`,
}, null, 2));
