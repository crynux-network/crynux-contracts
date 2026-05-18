import { Wallet } from "ethers";

const wallet = Wallet.createRandom();

console.log(`Address: ${wallet.address}`);
console.log(`Private key: ${wallet.privateKey}`);
console.log(`Mnemonic: ${wallet.mnemonic?.phrase}`);
