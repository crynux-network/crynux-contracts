import { EthBridger, getArbitrumNetworkInformationFromRollup, registerCustomArbitrumNetwork, type ArbitrumNetwork, } from '@arbitrum/sdk';
import { BigNumber } from '@ethersproject/bignumber';
import { Wallet } from '@ethersproject/wallet';
import { formatUnits, parseAbi, parseUnits } from 'viem';
import { expectPositionalArgs, primaryRuntime } from '../../common.js';
import { orbitRuntime, createOrbitChainProvider, createParentChainProvider, deploymentConfig, getParentCrynuxTokenAddress, getConfiguredDeployerPrivateKey, getCoreContracts, getDeployerAccount, orbitChainPublicClient, parentChainPublicClient } from './runtime.js';

const erc20Abi = parseAbi(['function balanceOf(address account) view returns (uint256)']);
const [depositAmountInput] = expectPositionalArgs(
  1,
  `npx tsx deployments/primary/scripts/${orbitRuntime.scriptDir}/deposit-native-cnx-to-crynux.ts <amount>`,
);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const depositAmount = parseUnits(depositAmountInput, 18);

if (depositAmount <= 0n) {
  throw new Error('Deposit amount must be greater than zero.');
}

const deployer = await getDeployerAccount();
const parentChainProvider = createParentChainProvider();
const orbitChainProvider = createOrbitChainProvider();
const parentChainSigner = new Wallet(await getConfiguredDeployerPrivateKey(), parentChainProvider);
const coreContracts = getCoreContracts();
const parentCrynuxTokenAddress = getParentCrynuxTokenAddress();

const parentBalanceBefore = await parentChainPublicClient.readContract({
  address: parentCrynuxTokenAddress,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [deployer.address],
});

if (parentBalanceBefore < depositAmount) {
  throw new Error(
    `Insufficient ${orbitRuntime.parentName} CNX balance. Required ${formatUnits(depositAmount, 18)}, available ${formatUnits(parentBalanceBefore, 18)}.`,
  );
}

const arbitrumNetworkInformation = await getArbitrumNetworkInformationFromRollup(coreContracts.rollup, parentChainProvider);
const arbitrumNetwork: ArbitrumNetwork = {
  name: deploymentConfig.name,
  chainId: deploymentConfig.chainId,
  parentChainId: arbitrumNetworkInformation.parentChainId,
  confirmPeriodBlocks: arbitrumNetworkInformation.confirmPeriodBlocks,
  ethBridge: arbitrumNetworkInformation.ethBridge,
  isCustom: true,
  isTestnet: primaryRuntime.isTestnet,
  nativeToken: arbitrumNetworkInformation.nativeToken,
};
registerCustomArbitrumNetwork(arbitrumNetwork);

if (arbitrumNetwork.nativeToken?.toLowerCase() !== parentCrynuxTokenAddress.toLowerCase()) {
  throw new Error(`Expected native token ${parentCrynuxTokenAddress}, got ${arbitrumNetwork.nativeToken ?? 'ETH'}.`);
}

const ethBridger = await EthBridger.fromProvider(orbitChainProvider);
const childBalanceBefore = await orbitChainPublicClient.getBalance({ address: deployer.address });

console.log(`${orbitRuntime.parentName} CNX native deposit to ${orbitRuntime.orbitName}:`);
console.log(
  JSON.stringify(
    {
      account: deployer.address,
      token: parentCrynuxTokenAddress,
      inbox: coreContracts.inbox,
      amount: formatUnits(depositAmount, 18),
      parentBalanceBefore: formatUnits(parentBalanceBefore, 18),
      childNativeBalanceBefore: formatUnits(childBalanceBefore, 18),
    },
    null,
    2,
  ),
);

const approveTransaction = await ethBridger.approveGasToken({
  parentSigner: parentChainSigner,
  amount: BigNumber.from(depositAmount.toString()),
});
const approveTransactionReceipt = await approveTransaction.wait();

console.log(`${orbitRuntime.parentName} CNX approve transaction receipt:`);
console.log(JSON.stringify(approveTransactionReceipt, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));
await sleep(30_000);

const depositTransaction = await ethBridger.deposit({
  parentSigner: parentChainSigner,
  amount: BigNumber.from(depositAmount.toString()),
});
const depositTransactionReceipt = await depositTransaction.wait();

console.log(`${orbitRuntime.parentName} CNX native deposit transaction receipt:`);
console.log(JSON.stringify(depositTransactionReceipt, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2));

const childTransactionReceipt = await depositTransactionReceipt.waitForChildTransactionReceipt(orbitChainProvider);

if (!childTransactionReceipt.complete) {
  throw new Error(`${orbitRuntime.orbitName} native deposit did not complete.`);
}

const childBalanceAfter = await orbitChainPublicClient.getBalance({ address: deployer.address });

console.log(`${orbitRuntime.orbitName} native deposit completed.`);
console.log(
  JSON.stringify(
    {
      account: deployer.address,
      childNativeBalanceAfter: formatUnits(childBalanceAfter, 18),
    },
    null,
    2,
  ),
);
