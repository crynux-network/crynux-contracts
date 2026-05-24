import { expect } from "chai";
import hre from "hardhat";

async function getEthers() {
    const connection = await hre.network.getOrCreate();
    return connection.ethers;
}

async function deployContracts(ethers: any) {
    const [
        deployer,
        writer,
        unauthorized,
        relayAdmin,
        creditsAdmin,
        slashReceiver,
        nodeOperator,
        delegator,
    ] = await ethers.getSigners();

    const credits = await ethers.deployContract("Credits");
    const benefitAddress = await ethers.deployContract("BenefitAddress");
    const delegatedStaking = await ethers.deployContract("DelegatedStaking", [
        slashReceiver.address,
    ]);
    const nodeStaking = await ethers.deployContract("NodeStaking", [
        await credits.getAddress(),
        await benefitAddress.getAddress(),
        await delegatedStaking.getAddress(),
        slashReceiver.address,
    ]);
    const parameterController = await ethers.deployContract("ParameterController", [
        await nodeStaking.getAddress(),
        await delegatedStaking.getAddress(),
        await credits.getAddress(),
        writer.address,
    ]);

    await credits.setStakingAddress(await nodeStaking.getAddress());
    await delegatedStaking.setNodeStakingAddress(await nodeStaking.getAddress());
    await credits.setParameterController(await parameterController.getAddress());
    await delegatedStaking.setParameterController(
        await parameterController.getAddress()
    );
    await nodeStaking.setParameterController(await parameterController.getAddress());

    return {
        deployer,
        writer,
        unauthorized,
        relayAdmin,
        creditsAdmin,
        slashReceiver,
        nodeOperator,
        delegator,
        credits,
        delegatedStaking,
        nodeStaking,
        parameterController,
    };
}

describe("ParameterController", () => {
    it("allows initializing parameter controller only once", async () => {
        const ethers = await getEthers();
        const [deployer, another] = await ethers.getSigners();
        const credits = await ethers.deployContract("Credits");
        const delegatedStaking = await ethers.deployContract("DelegatedStaking", [
            deployer.address,
        ]);
        const nodeStaking = await ethers.deployContract("NodeStaking", [
            await credits.getAddress(),
            deployer.address,
            await delegatedStaking.getAddress(),
            deployer.address,
        ]);

        await expect(
            nodeStaking.setParameterController(ethers.ZeroAddress)
        ).to.be.revertedWith("Parameter controller cannot be zero");

        await nodeStaking.setParameterController(deployer.address);
        await expect(
            nodeStaking.setParameterController(another.address)
        ).to.be.revertedWith("Parameter controller already set");

        await credits.setStakingAddress(await nodeStaking.getAddress());
        await expect(
            credits.setStakingAddress(another.address)
        ).to.be.revertedWith("Staking address already set");

        await delegatedStaking.setNodeStakingAddress(await nodeStaking.getAddress());
        await expect(
            delegatedStaking.setNodeStakingAddress(another.address)
        ).to.be.revertedWith("Node staking address already set");
    });

    it("enforces writer-only controller updates", async () => {
        const {
            writer,
            unauthorized,
            creditsAdmin,
            credits,
            parameterController,
            nodeOperator,
        } = await deployContracts(await getEthers());

        await expect(
            parameterController
                .connect(unauthorized)
                .setCreditsAdminAddress(creditsAdmin.address)
        ).to.be.revertedWith("Not called by writer");

        await parameterController
            .connect(writer)
            .setCreditsAdminAddress(creditsAdmin.address);
        await credits.connect(creditsAdmin).createCredits(nodeOperator.address, 11);

        expect(await credits.getCredits(nodeOperator.address)).to.equal(11);
    });

    it("rejects direct owner writes after controller is initialized", async () => {
        const { deployer, credits, delegatedStaking, nodeStaking } =
            await deployContracts(await getEthers());

        await expect(
            nodeStaking.connect(deployer).setMinStakeAmount(1)
        ).to.be.revertedWith("Not called by parameter controller");
        await expect(
            delegatedStaking.connect(deployer).setMinStakeAmount(1)
        ).to.be.revertedWith("Not called by parameter controller");
        await expect(
            credits.connect(deployer).setAdminAddress(deployer.address)
        ).to.be.revertedWith("Not called by parameter controller");
    });

    it("routes NodeStaking slash funds to slashReceiver", async () => {
        const ethers = await getEthers();
        const {
            writer,
            relayAdmin,
            slashReceiver,
            nodeOperator,
            credits,
            nodeStaking,
            parameterController,
        } = await deployContracts(ethers);

        await parameterController
            .connect(writer)
            .setNodeStakingAdminAddress(relayAdmin.address);
        await parameterController
            .connect(writer)
            .setNodeStakingMinStakeAmount(1);

        expect(await credits.getCredits(nodeOperator.address)).to.equal(0);

        await nodeStaking.connect(nodeOperator).stake(5, { value: 5 });

        const receiverBalanceBefore = await ethers.provider.getBalance(
            slashReceiver.address
        );
        await nodeStaking.connect(relayAdmin).slashStaking(nodeOperator.address);
        const receiverBalanceAfter = await ethers.provider.getBalance(
            slashReceiver.address
        );

        expect(receiverBalanceAfter - receiverBalanceBefore).to.equal(5n);
    });

    it("routes DelegatedStaking slash funds to slashReceiver", async () => {
        const ethers = await getEthers();
        const {
            writer,
            relayAdmin,
            slashReceiver,
            nodeOperator,
            delegator,
            nodeStaking,
            delegatedStaking,
            parameterController,
        } = await deployContracts(ethers);

        await parameterController
            .connect(writer)
            .setDelegatedStakingMinStakeAmount(1);
        await parameterController
            .connect(writer)
            .setNodeStakingAdminAddress(relayAdmin.address);
        await parameterController
            .connect(writer)
            .setNodeStakingMinStakeAmount(1);

        await nodeStaking.connect(nodeOperator).stake(1, { value: 1 });
        await delegatedStaking.connect(nodeOperator).setDelegatorShare(10);
        await delegatedStaking.connect(delegator).stake(nodeOperator.address, 3, {
            value: 3,
        });

        const receiverBalanceBefore = await ethers.provider.getBalance(
            slashReceiver.address
        );
        await nodeStaking.connect(relayAdmin).slashStaking(nodeOperator.address);
        const receiverBalanceAfter = await ethers.provider.getBalance(
            slashReceiver.address
        );

        expect(receiverBalanceAfter - receiverBalanceBefore).to.equal(4n);
    });
});
