import "dotenv/config";
import { configVariable, defineConfig } from "hardhat/config";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { mainnet as ethereum, sepolia as ethereumSepolia, base, baseSepolia } from "viem/chains";

const solidityConfig = {
    version: "0.8.24",
    settings: {
        optimizer: {
            enabled: true,
            runs: 200,
        },
        viaIR: true,
    },
};

const baseRpcUrl = process.env.BASE_RPC_URL ?? base.rpcUrls.default.http[0];
const baseSepoliaRpcUrl = process.env.BASE_SEPOLIA_RPC_URL ?? baseSepolia.rpcUrls.default.http[0];
const ethereumRpcUrl = process.env.ETHEREUM_RPC_URL ?? "https://eth-mainnet.g.alchemy.com/public";
const ethereumSepoliaRpcUrl = process.env.ETHEREUM_SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const crynuxOnBaseSepoliaRpcUrl = process.env.CRYNUX_ON_BASE_SEPOLIA_RPC_URL ?? "https://json-rpc.base-sepolia.crynux.io";
const crynuxOnBaseRpcUrl = process.env.CRYNUX_ON_BASE_RPC_URL ?? "https://json-rpc.base.crynux.io";
const ignitionRequiredConfirmations = Number(process.env.IGNITION_REQUIRED_CONFIRMATIONS ?? "1");

export default defineConfig({
    plugins: [hardhatToolboxMochaEthers],
    ignition: {
        requiredConfirmations: ignitionRequiredConfirmations,
    },
    verify: {
        etherscan: {
            apiKey: configVariable("ETHERSCAN_API_KEY"),
        },
    },
    solidity: {
        profiles: {
            default: solidityConfig,
            production: solidityConfig,
        },
    },
    networks: {
        ethereum: {
            type: "http",
            chainType: "generic",
            chainId: ethereum.id,
            url: ethereumRpcUrl,
            accounts: [configVariable("MAINNET_DEPLOYER_PRIVATE_KEY")],
        },
        ethereumSepolia: {
            type: "http",
            chainType: "generic",
            chainId: ethereumSepolia.id,
            url: ethereumSepoliaRpcUrl,
            accounts: [configVariable("TESTNET_DEPLOYER_PRIVATE_KEY")],
        },
        base: {
            type: "http",
            chainType: "op",
            chainId: base.id,
            url: baseRpcUrl,
            accounts: [configVariable("MAINNET_DEPLOYER_PRIVATE_KEY")],
        },
        baseSepolia: {
            type: "http",
            chainType: "op",
            chainId: baseSepolia.id,
            url: baseSepoliaRpcUrl,
            accounts: [configVariable("TESTNET_DEPLOYER_PRIVATE_KEY")],
        },
        crynuxOnBase: {
            type: "http",
            chainType: "generic",
            chainId: 18896214,
            url: crynuxOnBaseRpcUrl,
            accounts: [configVariable("MAINNET_DEPLOYER_PRIVATE_KEY")],
        },
        crynuxOnBaseSepolia: {
            type: "http",
            chainType: "generic",
            chainId: 188962142,
            url: crynuxOnBaseSepoliaRpcUrl,
            accounts: [configVariable("TESTNET_DEPLOYER_PRIVATE_KEY")],
        },
    },
    typechain: {
        dontOverrideCompile: true,
    },
});
