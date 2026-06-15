import { formatUnits, isAddress, parseAbi, parseUnits, type Address } from 'viem';
import { expectPositionalArgs, primaryRuntime } from '../common.js';
import { basePublicClient, bridgedCrynuxToken, getBaseCrynuxTokenAddress, getBaseDeployerWalletClient } from './common.js';

const erc20Abi = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to,uint256 amount) returns (bool)',
]);
const balanceCheckWaitMs = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getTransferArgs(): { recipient: Address; amount: bigint } {
  const [recipientArg, amountArg] = expectPositionalArgs(
    2,
    'npx tsx deployments/primary/scripts/base/transfer-cnx.ts <address> <integer-cnx-amount>',
  );

  if (!isAddress(recipientArg)) {
    throw new Error('The recipient address must be a valid EVM address.');
  }

  if (!/^[1-9]\d*$/.test(amountArg)) {
    throw new Error('The CNX amount must be a positive integer.');
  }

  return {
    recipient: recipientArg,
    amount: parseUnits(amountArg, bridgedCrynuxToken.decimals),
  };
}

const { recipient, amount } = getTransferArgs();
const baseCrynuxTokenAddress = getBaseCrynuxTokenAddress();
const walletClient = await getBaseDeployerWalletClient();
const account = walletClient.account;

if (account === undefined) {
  throw new Error(`${primaryRuntime.names.base} deployer account is required.`);
}

const balance = await basePublicClient.readContract({
  address: baseCrynuxTokenAddress,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [account.address],
});

if (balance < amount) {
  throw new Error(`Insufficient ${primaryRuntime.names.base} CNX balance. Required ${formatUnits(amount, 18)}, available ${formatUnits(balance, 18)}.`);
}

const transferHash = await walletClient.writeContract({
  address: baseCrynuxTokenAddress,
  abi: erc20Abi,
  functionName: 'transfer',
  args: [recipient, amount],
});
const transferReceipt = await basePublicClient.waitForTransactionReceipt({ hash: transferHash });

console.log(`${primaryRuntime.names.base} CNX transfer transaction receipt:`);
console.log(JSON.stringify(transferReceipt, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));

console.log(`Waiting ${balanceCheckWaitMs / 1000} seconds before checking the recipient balance...`);
await sleep(balanceCheckWaitMs);

const recipientBalance = await basePublicClient.readContract({
  address: baseCrynuxTokenAddress,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [recipient],
});

console.log(`${primaryRuntime.names.base} CNX balance for ${recipient}: ${formatUnits(recipientBalance, bridgedCrynuxToken.decimals)}`);
