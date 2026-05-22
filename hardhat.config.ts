import { configVariable, defineConfig } from "hardhat/config";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";

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

const baseRpcUrl = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const baseSepoliaRpcUrl = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
const ignitionRequiredConfirmations = Number(process.env.IGNITION_REQUIRED_CONFIRMATIONS ?? "5");

export default defineConfig({
    plugins: [hardhatToolboxMochaEthers],
    ignition: {
        requiredConfirmations: ignitionRequiredConfirmations,
    },
    solidity: {
        profiles: {
            default: solidityConfig,
            production: solidityConfig,
        },
    },
    networks: {
        base: {
            type: "http",
            chainType: "op",
            chainId: 8453,
            url: baseRpcUrl,
            accounts: [configVariable("L2_ROLLUP_DEPLOYER_PRIVATE_KEY")],
        },
        baseSepolia: {
            type: "http",
            chainType: "op",
            chainId: 84532,
            url: baseSepoliaRpcUrl,
            accounts: [
                configVariable("L2_ROLLUP_DEPLOYER_PRIVATE_KEY"),
                configVariable("L2_BATCH_POSTER_PRIVATE_KEY"),
                configVariable("L2_VALIDATOR_PRIVATE_KEY"),
            ],
        },
        crynuxOnBaseSepolia: {
            type: "http",
            chainType: "generic",
            chainId: 18896213,
            url: "http://127.0.0.1:8449",
            accounts: [
                configVariable("L2_ROLLUP_DEPLOYER_PRIVATE_KEY"),
            ],
        },
    },
    typechain: {
        dontOverrideCompile: true,
    },
});
