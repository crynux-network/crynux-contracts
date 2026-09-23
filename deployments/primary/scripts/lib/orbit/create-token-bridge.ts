import { createTokenBridgeFetchTokenBridgeContracts, createTokenBridgePrepareCustomFeeTokenApprovalTransactionRequest, createTokenBridgePrepareTransactionReceipt, createTokenBridgePrepareTransactionRequest, fetchAllowance, utils, } from '@arbitrum/chain-sdk';
import { formatUnits, parseUnits, zeroAddress } from 'viem';
import { expectPositionalArgs } from '../../common.js';
import { registerOrbitNetwork } from './bridge-network.js';
import { orbitRuntime, createParentChainProvider, getParentCrynuxTokenAddress, getCoreContracts, getDeployerAccount, orbitChainPublicClient, parentChainPublicClient } from './runtime.js';

expectPositionalArgs(0, `npx tsx deployments/primary/scripts/${orbitRuntime.scriptDir}/create-token-bridge.ts`);

const deployer = await getDeployerAccount();
const coreContracts = getCoreContracts();
const tokenBridgeCreator = utils.getTokenBridgeCreatorAddress(parentChainPublicClient);
const parentCrynuxTokenAddress = getParentCrynuxTokenAddress();
const tokenBridgeRequiredAllowance = parseUnits('1', 18);

const recordedTokenBridgeContracts = await createTokenBridgeFetchTokenBridgeContracts({
  inbox: coreContracts.inbox,
  parentChainPublicClient,
});
const isDeployed = recordedTokenBridgeContracts.parentChainContracts.router !== zeroAddress;

if (!isDeployed) {
  const currentAllowance = await fetchAllowance({
    address: parentCrynuxTokenAddress,
    owner: deployer.address,
    spender: tokenBridgeCreator,
    publicClient: parentChainPublicClient,
  });

  console.log('Token bridge custom gas token approval state:');
  console.log(
    JSON.stringify(
      {
        owner: deployer.address,
        spender: tokenBridgeCreator,
        token: parentCrynuxTokenAddress,
        requiredAllowance: formatUnits(tokenBridgeRequiredAllowance, 18),
        currentAllowance: formatUnits(currentAllowance, 18),
      },
      null,
      2,
    ),
  );

  if (currentAllowance < tokenBridgeRequiredAllowance) {
    const approvalTransactionRequest = await createTokenBridgePrepareCustomFeeTokenApprovalTransactionRequest({
      amount: tokenBridgeRequiredAllowance,
      nativeToken: parentCrynuxTokenAddress,
      owner: deployer.address,
      publicClient: parentChainPublicClient,
    });
    const approvalTransactionHash = await parentChainPublicClient.sendRawTransaction({
      serializedTransaction: await deployer.signTransaction(approvalTransactionRequest),
    });
    const approvalTransactionReceipt = await parentChainPublicClient.waitForTransactionReceipt({
      hash: approvalTransactionHash,
    });

    console.log('Token bridge custom gas token approve transaction receipt:');
    console.log(
      JSON.stringify(approvalTransactionReceipt, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2),
    );
  }

  const createTokenBridgeTransactionRequest = await createTokenBridgePrepareTransactionRequest({
    params: {
      rollup: coreContracts.rollup,
      rollupOwner: deployer.address,
    },
    parentChainPublicClient,
    account: deployer.address,
  });

  console.log('Deploying the TokenBridge...');
  const createTokenBridgeTransactionHash = await parentChainPublicClient.sendRawTransaction({
    serializedTransaction: await deployer.signTransaction(createTokenBridgeTransactionRequest),
  });
  const createTokenBridgeTransactionReceipt = createTokenBridgePrepareTransactionReceipt(
    await parentChainPublicClient.waitForTransactionReceipt({ hash: createTokenBridgeTransactionHash }),
  );

  console.log('Token bridge deployment transaction receipt:');
  console.log(
    JSON.stringify(createTokenBridgeTransactionReceipt, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2),
  );

  await registerOrbitNetwork(createParentChainProvider());

  console.log('Waiting for retryable tickets to execute on the Orbit chain...');
  const retryableReceipts = await createTokenBridgeTransactionReceipt.waitForRetryables({
    orbitPublicClient: orbitChainPublicClient,
  });

  for (const [index, retryableReceipt] of retryableReceipts.entries()) {
    if (retryableReceipt.status !== 'success') {
      throw new Error(`Retryable ${index + 1} status is not success: ${retryableReceipt.status}.`);
    }
  }
} else {
  console.log('Token bridge contracts are already deployed.');
}

const tokenBridgeContracts = await createTokenBridgeFetchTokenBridgeContracts({
  inbox: coreContracts.inbox,
  parentChainPublicClient,
});

console.log('Token bridge contracts:');
console.log(JSON.stringify(tokenBridgeContracts, null, 2));
