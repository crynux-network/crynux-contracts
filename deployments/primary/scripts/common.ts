import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'hardhat';
import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export type PrimaryDeploymentNetwork = 'testnet' | 'mainnet';
export type PrimaryLayer = 'ethereum' | 'base' | 'crynux-on-base' | 'near';

type ParsedCli = {
  network: PrimaryDeploymentNetwork;
  positionalArgs: string[];
  optionArgs: string[];
};

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const primaryDir = resolve(scriptsDir, '..');

const parsedCli = parsePrimaryCliArgs(process.argv.slice(2));

export const primaryRuntime = {
  network: parsedCli.network,
  positionalArgs: parsedCli.positionalArgs,
  optionArgs: parsedCli.optionArgs,
  networkDir: resolve(primaryDir, parsedCli.network),
  isTestnet: parsedCli.network === 'testnet',
  names: parsedCli.network === 'testnet'
    ? {
        ethereum: 'Ethereum Sepolia',
        base: 'Base Sepolia',
        crynuxOnBase: 'Crynux on Base Sepolia',
        near: 'NEAR Testnet',
      }
    : {
        ethereum: 'Ethereum',
        base: 'Base',
        crynuxOnBase: 'Crynux on Base',
        near: 'NEAR',
      },
  hardhatNetworks: parsedCli.network === 'testnet'
    ? {
        ethereum: 'ethereumSepolia',
        base: 'baseSepolia',
        crynuxOnBase: 'crynuxOnBaseSepolia',
      }
    : {
        ethereum: 'ethereum',
        base: 'base',
        crynuxOnBase: 'crynuxOnBase',
      },
} as const;

export type PrimaryConfig = {
  daoTreasuryAddress: Address | '';
  relayWalletColdAddress: Address | '';
};

function parsePrimaryCliArgs(rawArgs: string[]): ParsedCli {
  let network: PrimaryDeploymentNetwork | undefined;
  const positionalArgs: string[] = [];
  const optionArgs: string[] = [];

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg.startsWith('--network=')) {
      const value = arg.slice('--network='.length);
      if (value === 'testnet' || value === 'mainnet') {
        network = value;
      } else {
        throw new Error(`Invalid --network value: ${value}. Use --network=testnet or --network=mainnet.`);
      }
      continue;
    }

    if (arg === '--network') {
      const value = rawArgs[index + 1];
      if (value !== 'testnet' && value !== 'mainnet') {
        throw new Error('Usage: pass --network=testnet or --network=mainnet.');
      }
      network = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--')) {
      optionArgs.push(arg);
      continue;
    }

    positionalArgs.push(arg);
  }

  if (network === undefined) {
    throw new Error('Missing required --network option. Use --network=testnet or --network=mainnet.');
  }

  return { network, positionalArgs, optionArgs };
}

export function getPrimaryLayerDir(layer: PrimaryLayer): string {
  const layerFolder = primaryRuntime.network === 'testnet'
    ? {
        ethereum: 'ethereum-sepolia',
        base: 'base-sepolia',
        'crynux-on-base': 'crynux-on-base-sepolia',
        near: 'near',
      }[layer]
    : {
        ethereum: 'ethereum',
        base: 'base',
        'crynux-on-base': 'crynux-on-base',
        near: 'near',
      }[layer];

  return resolve(primaryRuntime.networkDir, layerFolder);
}

export function getPrimaryLayerFile(layer: PrimaryLayer, ...relativePaths: string[]): string {
  return resolve(getPrimaryLayerDir(layer), ...relativePaths);
}

export function getPrimaryConfigFilePath(): string {
  return resolve(primaryRuntime.networkDir, 'common.json');
}

export async function getPrimaryConfig(): Promise<PrimaryConfig> {
  return JSON.parse(await readFile(getPrimaryConfigFilePath(), 'utf8')) as PrimaryConfig;
}

async function getConfiguredPrivateKey(networkName: string, accountIndex: number, accountDescription: string): Promise<Hex> {
  const networkConfig = config.networks[networkName];

  if (networkConfig === undefined || networkConfig.type !== 'http' || !Array.isArray(networkConfig.accounts)) {
    throw new Error(`The ${networkName} network must use explicit HTTP accounts for ${accountDescription}.`);
  }

  const privateKey = networkConfig.accounts[accountIndex];

  if (privateKey === undefined) {
    throw new Error(`The ${networkName} network must define ${accountDescription}.`);
  }

  return (await privateKey.getHexString()) as Hex;
}

export async function getConfiguredRpcUrl(networkName: string, networkDescription: string): Promise<string> {
  const networkConfig = config.networks[networkName];

  if (networkConfig === undefined || networkConfig.type !== 'http') {
    throw new Error(`The ${networkName} network must define an HTTP RPC URL for ${networkDescription}.`);
  }

  return networkConfig.url.getUrl();
}

export function getConfiguredDeployerPrivateKey(): Promise<Hex> {
  return getConfiguredPrivateKey(primaryRuntime.hardhatNetworks.ethereum, 0, 'a deployer account');
}

export async function getPrimaryDeployerAccount() {
  return privateKeyToAccount(await getConfiguredDeployerPrivateKey());
}

export function assertAddress(value: string, name: string): Address {
  if (!value.startsWith('0x') || value.length !== 42) {
    throw new Error(`${name} must be a deployed address.`);
  }

  return value as Address;
}

export function buildPrimaryDeploymentId(name: string): string {
  return `${name}-${primaryRuntime.network}`;
}

export function buildPrimaryCacheFileName(name: string): string {
  return `${name}-${primaryRuntime.network}.json`;
}

export function getPositionalArg(index: number): string | undefined {
  return primaryRuntime.positionalArgs[index];
}

export function expectPositionalArgs(
  count: number,
  usageWithoutNetwork: string,
  allowedOptions: readonly string[] = [],
): string[] {
  expectSupportedOptions(allowedOptions);

  if (primaryRuntime.positionalArgs.length !== count) {
    throw new Error(`Usage: ${usageWithoutNetwork} --network=<testnet|mainnet>`);
  }

  return primaryRuntime.positionalArgs;
}

export function expectAtLeastPositionalArgs(
  minCount: number,
  usageWithoutNetwork: string,
  allowedOptions: readonly string[] = [],
): string[] {
  expectSupportedOptions(allowedOptions);

  if (primaryRuntime.positionalArgs.length < minCount) {
    throw new Error(`Usage: ${usageWithoutNetwork} --network=<testnet|mainnet>`);
  }

  return primaryRuntime.positionalArgs;
}

function expectSupportedOptions(allowedOptions: readonly string[]): void {
  const unsupportedOption = primaryRuntime.optionArgs.find((option) => !allowedOptions.includes(option));
  if (unsupportedOption !== undefined) {
    throw new Error(`Unsupported option: ${unsupportedOption}.`);
  }
}

export function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      shell: true,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code: number | null) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}.`));
    });
  });
}
