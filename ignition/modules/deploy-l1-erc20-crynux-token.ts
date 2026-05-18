import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("DeployL1Erc20CrynuxToken", (m) => {
    const crynuxToken = m.contract("CrynuxToken");

    return { crynuxToken };
});
