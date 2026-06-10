import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("DeployBenefitAddress", (m) => {
    const benefitAddress = m.contract("BenefitAddress");

    return {
        benefitAddress,
    };
});
