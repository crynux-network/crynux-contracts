import { createTokenBridgeFetchTokenBridgeContracts, fetchAllowance } from '@arbitrum/chain-sdk';
import {
  EthBridger,
  getArbitrumNetworkInformationFromRollup,
  registerCustomArbitrumNetwork,
  type ArbitrumNetwork,
} from '@arbitrum/sdk';
import { BigNumber } from '@ethersproject/bignumber';
import { Wallet } from '@ethersproject/wallet';
import { formatUnits, parseAbi, parseUnits, type Address } from 'viem';
import { expectAtLeastPositionalArgs, primaryRuntime } from '../common.js';
import {
  assertAddress,
  deploymentConfig,
  createOrbitChainProvider,
  createParentChainProvider,
  getBaseCrynuxTokenAddress,
  getConfiguredDeployerPrivateKey,
  getCoreContracts,
  getDeployerAccount,
  orbitChainPublicClient,
  parentChainPublicClient,
} from './common.js';

const erc20Abi = parseAbi(['function balanceOf(address account) view returns (uint256)']);
const [depositAmountInput, destinationAddressInput, ...extraArgs] = expectAtLeastPositionalArgs(
  1,
  'npx tsx deployments/primary/scripts/crynux-on-base/deposit-base-cnx-to-crynux.ts <amount> [destinationAddress]',
);

if (extraArgs.length > 0) {
  throw new Error(
    'Usage: npx tsx deployments/primary/scripts/crynux-on-base/deposit-base-cnx-to-crynux.ts <amount> [destinationAddress] --network=<testnet|mainnet>',
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const depositAmount = parseUnits(depositAmountInput, 18);

if (depositAmount <= 0n) {
  throw new Error('Deposit amount must be greater than zero.');
}

const deployer = await getDeployerAccount();
const destinationAddress = (destinationAddressInput === undefined
  ? deployer.address
  : assertAddress(destinationAddressInput, 'destinationAddress')) as Address;
const parentChainProvider = createParentChainProvider();
const orbitChainProvider = createOrbitChainProvider();
const parentChainSigner = new Wallet(await getConfiguredDeployerPrivateKey(), parentChainProvider);
const coreContracts = getCoreContracts();
const baseCrynuxTokenAddress = getBaseCrynuxTokenAddress();

const parentBalanceBefore = await parentChainPublicClient.readContract({
  address: baseCrynuxTokenAddress,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [deployer.address],
});

if (parentBalanceBefore < depositAmount) {
  throw new Error(
    `Insufficient ${primaryRuntime.names.base} CNX balance. Required ${formatUnits(depositAmount, 18)}, available ${formatUnits(parentBalanceBefore, 18)}.`,
  );
}

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
  isTestnet: primaryRuntime.isTestnet,
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

const ethBridger = await EthBridger.fromProvider(orbitChainProvider);
const depositRequest = await ethBridger.getDepositToRequest({
  parentProvider: parentChainProvider,
  childProvider: orbitChainProvider,
  from: deployer.address,
  amount: BigNumber.from(depositAmount.toString()),
  destinationAddress,
});
const requiredParentTokenAmount = BigInt(depositRequest.retryableData.deposit.toString());
const childBalanceBefore = await orbitChainPublicClient.getBalance({ address: destinationAddress });
const currentAllowance = await fetchAllowance({
  address: baseCrynuxTokenAddress,
  owner: deployer.address,
  spender: coreContracts.inbox,
  publicClient: parentChainPublicClient,
});

if (parentBalanceBefore < requiredParentTokenAmount) {
  throw new Error(
    `Insufficient ${primaryRuntime.names.base} CNX balance. Required ${formatUnits(requiredParentTokenAmount, 18)}, available ${formatUnits(parentBalanceBefore, 18)}.`,
  );
}

console.log(`${primaryRuntime.names.base} CNX to ${primaryRuntime.names.crynuxOnBase} deposit state:`);
console.log(
  JSON.stringify(
    {
      account: deployer.address,
      destinationAddress,
      token: baseCrynuxTokenAddress,
      inbox: coreContracts.inbox,
      amount: formatUnits(depositAmount, 18),
      requiredParentTokenAmount: formatUnits(requiredParentTokenAmount, 18),
      parentBalanceBefore: formatUnits(parentBalanceBefore, 18),
      destinationNativeBalanceBefore: formatUnits(childBalanceBefore, 18),
      currentAllowance: formatUnits(currentAllowance, 18),
    },
    null,
    2,
  ),
);

if (currentAllowance < requiredParentTokenAmount) {
  const approveTransaction = await ethBridger.approveGasToken({
    parentSigner: parentChainSigner,
    amount: BigNumber.from(requiredParentTokenAmount.toString()),
  });
  const approveTransactionReceipt = await approveTransaction.wait();

  console.log(`${primaryRuntime.names.base} CNX approve transaction receipt:`);
  console.log(JSON.stringify(approveTransactionReceipt, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));
  await sleep(30_000);
}

const depositTransaction = await ethBridger.depositTo({
  ...depositRequest,
  parentSigner: parentChainSigner,
  childProvider: orbitChainProvider,
});
const depositTransactionReceipt = await depositTransaction.wait();

console.log(`${primaryRuntime.names.base} CNX deposit transaction receipt:`);
console.log(JSON.stringify(depositTransactionReceipt, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));

const childTransactionReceipt = await depositTransactionReceipt.waitForChildTransactionReceipt(orbitChainProvider);

if (!childTransactionReceipt.complete) {
  throw new Error(`${primaryRuntime.names.crynuxOnBase} deposit did not complete.`);
}

const childBalanceAfter = await orbitChainPublicClient.getBalance({ address: destinationAddress });

console.log(`${primaryRuntime.names.crynuxOnBase} deposit completed.`);
console.log(
  JSON.stringify(
    {
      destinationAddress,
      destinationNativeBalanceAfter: formatUnits(childBalanceAfter, 18),
      destinationNativeBalanceDelta: formatUnits(childBalanceAfter - childBalanceBefore, 18),
    },
    null,
    2,
  ),
);
