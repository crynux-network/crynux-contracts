# Primary Near Layer

This workflow bridges Primary CNX from Ethereum to NEAR through NEAR Omni Bridge and records the NEAR NEP-141 bridged CNX token.

Aurora virtual chain deposit, token registration, native gas token configuration, and Crynux-on-Near chain operations are outside this workflow.

## Deployment Flow

### 1) Install NEAR CLI

1. Install NEAR CLI on the deployment machine:
   - Windows PowerShell:
     ```powershell
     irm https://github.com/near/near-cli-rs/releases/latest/download/near-cli-rs-installer.ps1 | iex
     ```
   - macOS or Linux:
     ```shell
     curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/near-cli-rs/releases/latest/download/near-cli-rs-installer.sh | sh
     ```
2. Confirm the `near` command is available:
   - `near --version`

NEAR CLI creates, imports, checks, and signs with NEAR accounts. The Ethereum deployer private key is used only for Ethereum-side Omni Bridge transactions and MUST NOT be used as a named NEAR account access key.

### 2) Prepare NEAR Deployer Account

Security requirement: `save-to-keychain` stores the generated NEAR access key in the operating system credential store. On Windows, this is Windows Credential Manager. The credential store protects the key under the Windows user profile, but it does not add a NEAR CLI per-key password and it is not a signer-only boundary. NEAR CLI retrieves the private key into the local process to sign transactions, and any process running as the same Windows user with access to the credential target can retrieve the stored secret. Deployment accounts that require non-exportable private keys MUST use Ledger, MPC, or an external signer instead of `save-to-keychain` and `sign-with-keychain`.

#### 2.1) Testnet

1. Create the testnet account:
   - `near account create-account sponsor-by-faucet-service crynux-deployer.testnet autogenerate-new-keypair save-to-keychain network-config testnet create`
2. Confirm the account exists:
   - `near account view-account-summary crynux-deployer.testnet network-config testnet now`

The create command creates a named `.testnet` account, generates a full-access key, saves the key to the local keychain, and funds the account through the testnet faucet service.

#### 2.2) Mainnet

1. Open a NEAR mainnet wallet from `https://wallet.near.org/`.
2. Create `crynux-deployer.near` in the wallet.
3. Fund the account with NEAR on mainnet by transferring NEAR from an exchange, treasury wallet, or another operator-controlled NEAR account.
4. Confirm the account has a positive NEAR balance in the wallet.
5. Import the account into the local keychain:
   - `near account import-account`
6. Confirm the account exists:
   - `near account view-account-summary crynux-deployer.near network-config mainnet now`

The mainnet account MUST hold enough NEAR to pay for NEAR-side storage registration and transaction gas.

### 3) Confirm NEAR Config File

1. Set the testnet deployer account in `testnet/near/config.json`:
   - `"deployerAccountId": "crynux-deployer.testnet"`
2. Set the mainnet deployer account in `mainnet/near/config.json`:
   - `"deployerAccountId": "crynux-deployer.near"`

The config file provides the default NEAR deployer account, Omni Bridge addresses, and NEAR RPC URL.

### 4) Create NEAR Bridged CNX Token

1. Start NEAR bridged token creation:
   - `npx tsx deployments/primary/scripts/near/create-bridged-token.ts --network=<testnet|mainnet>`
2. Confirm `<network>/near/contracts.json` records `nearCrynuxTokenAccountId`.

This script uses the Omni Bridge SDK to log Ethereum CNX metadata, deploy the NEAR bridged token, and record the NEAR token account.

### 5) Bridge CNX From Ethereum To NEAR

1. Submit the Ethereum-side CNX bridge transaction:
   - `npx tsx deployments/primary/scripts/near/bridge-cnx-from-ethereum.ts <integer-cnx-amount> --network=<testnet|mainnet>`
2. Use a positive integer CNX amount.
3. To override the configured recipient account for one transfer, pass it explicitly:
   - `npx tsx deployments/primary/scripts/near/bridge-cnx-from-ethereum.ts <integer-cnx-amount> <near-recipient-account-id> --network=<testnet|mainnet>`
4. Record the printed Ethereum bridge transaction hash.
5. Monitor the printed transfer status URL until the Omni Bridge relayer claims the transfer on NEAR.

This script reads the default recipient from `deployerAccountId` in the NEAR config file when the recipient argument is omitted. It checks the Ethereum deployer CNX balance, gets the Omni Bridge relayer fee quote, includes the quoted relayer fees, approves the Ethereum Omni Bridge contract when required, submits the SDK-built transfer transaction, and prints the transfer status URL. The NEAR `fin_transfer` claim is performed by an active Omni Bridge relayer.

### 6) Transfer CNX On NEAR

1. Transfer CNX from the configured NEAR deployer account to another NEAR account:
   - `npx tsx deployments/primary/scripts/near/transfer-cnx-on-near.ts <integer-cnx-amount> <near-recipient-account-id> --network=<testnet|mainnet>`
2. Confirm the script prints the NEAR `ft_transfer` transaction hash and verifies the target recipient balance.

This script sends NEP-141 CNX from `deployerAccountId` in the NEAR config file, registers the target recipient storage when required, waits 30 seconds after the transfer transaction, queries `ft_balance_of`, and verifies the target recipient balance increased by the transfer amount.

### 7) Query Global NEAR CNX Information

1. Query global NEAR CNX token information:
   - `npx tsx deployments/primary/scripts/near/query-cnx-on-near.ts --network=<testnet|mainnet>`
2. Confirm the printed token metadata is the NEAR bridged CNX token.
3. Confirm the printed total supply matches the expected bridged CNX amount.

This script reads `nearCrynuxTokenAccountId`, queries `ft_metadata` and `ft_total_supply`, and prints the token account, metadata, and total supply.

## Files

Near layer files are network-scoped:

- `deployments/primary/scripts/near/`
- `deployments/primary/testnet/near/config.json`
- `deployments/primary/testnet/near/contracts.json`
- `deployments/primary/mainnet/near/config.json`
- `deployments/primary/mainnet/near/contracts.json`

Shared script logic lives under `scripts/near`. Network folders contain only configuration and deployment artifacts.
