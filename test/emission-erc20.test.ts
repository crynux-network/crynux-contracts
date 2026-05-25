import { expect } from "chai";
import hre from "hardhat";

const TOKEN_UNIT = 10n ** 18n;
const YEAR0_EMISSION = 1_723_466_646n;
const TOTAL_PERIODS = 1 + 20 * 52;
const WEEKS_PER_YEAR = 52;

const WEEKLY_EMISSIONS_BY_YEAR = [
    13_257_447n,
    12_171_771n,
    11_175_003n,
    10_259_862n,
    9_419_664n,
    8_648_271n,
    7_940_049n,
    7_289_824n,
    6_692_848n,
    6_144_758n,
    5_641_553n,
    5_179_556n,
    4_755_393n,
    4_365_966n,
    4_008_429n,
    3_680_172n,
    3_378_796n,
    3_102_100n,
    2_848_064n,
    2_614_832n,
];

async function getEthers() {
    const connection = await hre.network.getOrCreate();
    return connection.ethers;
}

function nominalEmissionForPeriod(periodIndex: number): bigint {
    if (periodIndex === 0) {
        return YEAR0_EMISSION;
    }
    const yearIndex = Math.floor((periodIndex - 1) / WEEKS_PER_YEAR) + 1;
    return WEEKLY_EMISSIONS_BY_YEAR[yearIndex - 1];
}

function primarySplitForPeriod(periodIndex: number, initCost: bigint) {
    const totalAmount = nominalEmissionForPeriod(periodIndex) * TOKEN_UNIT;
    const yearIndex = periodIndex === 0 ? 0 : Math.floor((periodIndex - 1) / WEEKS_PER_YEAR) + 1;
    const daoPercent = yearIndex <= 1 ? 30n : 20n;
    let daoAmount = (totalAmount * daoPercent) / 100n;
    const relayAmount = totalAmount - ((totalAmount * daoPercent) / 100n);

    if (periodIndex === 0 && initCost > 0n) {
        daoAmount -= initCost * TOKEN_UNIT;
    }

    return { totalAmount, relayAmount, daoAmount };
}

async function setTimestamp(timestamp: number) {
    const ethers = await getEthers();
    await ethers.provider.send("evm_setNextBlockTimestamp", [timestamp]);
    await ethers.provider.send("evm_mine", []);
}

describe("EmissionERC20", () => {
    it("rejects invalid constructor parameters", async () => {
        const ethers = await getEthers();
        const [deployer, daoTreasury, relayCold] = await ethers.getSigners();
        const token = await ethers.deployContract("CrynuxToken");

        const latest = await ethers.provider.getBlock("latest");
        const startTimestamp = Number(latest!.timestamp) + 100;

        await expect(
            ethers.deployContract("EmissionERC20", [
                ethers.ZeroAddress,
                0,
                daoTreasury.address,
                relayCold.address,
                startTimestamp,
                0,
                0,
            ])
        ).to.be.revertedWith("token is zero");

        await expect(
            ethers.deployContract("EmissionERC20", [
                await token.getAddress(),
                0,
                ethers.ZeroAddress,
                relayCold.address,
                startTimestamp,
                0,
                0,
            ])
        ).to.be.revertedWith("dao treasury is zero");

        await expect(
            ethers.deployContract("EmissionERC20", [
                await token.getAddress(),
                0,
                daoTreasury.address,
                ethers.ZeroAddress,
                startTimestamp,
                0,
                0,
            ])
        ).to.be.revertedWith("relay cold wallet is zero");

        await expect(
            ethers.deployContract("EmissionERC20", [
                await token.getAddress(),
                1,
                daoTreasury.address,
                relayCold.address,
                startTimestamp,
                0,
                1,
            ])
        ).to.be.revertedWith("mirror init cost must be zero");

        await expect(
            ethers.deployContract("EmissionERC20", [
                await token.getAddress(),
                0,
                daoTreasury.address,
                relayCold.address,
                startTimestamp,
                TOTAL_PERIODS + 1,
                0,
            ])
        ).to.be.revertedWith("initial index exceeds max");

        await deployer.getAddress();
    });

    it("enforces due time, prevents duplicate emission, and supports missed-period catch-up", async () => {
        const ethers = await getEthers();
        const [, daoTreasury, relayCold, caller] = await ethers.getSigners();

        const token = await ethers.deployContract("CrynuxToken");
        const latest = await ethers.provider.getBlock("latest");
        const startTimestamp = Number(latest!.timestamp) + 600;

        const emission = await ethers.deployContract("EmissionERC20", [
            await token.getAddress(),
            0,
            daoTreasury.address,
            relayCold.address,
            startTimestamp,
            0,
            0,
        ]);

        const fundAmount =
            (YEAR0_EMISSION +
                WEEKLY_EMISSIONS_BY_YEAR[0] +
                WEEKLY_EMISSIONS_BY_YEAR[0] +
                WEEKLY_EMISSIONS_BY_YEAR[0]) *
            TOKEN_UNIT;
        await token.transfer(await emission.getAddress(), fundAmount);

        await expect(emission.connect(caller).emission()).to.be.revertedWith(
            "emission is not due"
        );

        await setTimestamp(startTimestamp + 3 * 7 * 24 * 60 * 60);

        for (let period = 0; period <= 3; period += 1) {
            const relayBefore = await token.balanceOf(relayCold.address);
            const daoBefore = await token.balanceOf(daoTreasury.address);

            await emission.connect(caller).emission();

            const split = primarySplitForPeriod(period, 0n);
            expect(await token.balanceOf(relayCold.address)).to.equal(
                relayBefore + split.relayAmount
            );
            expect(await token.balanceOf(daoTreasury.address)).to.equal(
                daoBefore + split.daoAmount
            );
        }

        expect(await emission.nextEmissionIndex()).to.equal(4);

        await expect(emission.connect(caller).emission()).to.be.revertedWith(
            "emission is not due"
        );
    });

    it("applies initCost only on the first primary emission", async () => {
        const ethers = await getEthers();
        const [, daoTreasury, relayCold] = await ethers.getSigners();
        const token = await ethers.deployContract("CrynuxToken");
        const latest = await ethers.provider.getBlock("latest");
        const startTimestamp = Number(latest!.timestamp) + 100;
        const initCost = 10n;

        const emission = await ethers.deployContract("EmissionERC20", [
            await token.getAddress(),
            0,
            daoTreasury.address,
            relayCold.address,
            startTimestamp,
            0,
            initCost,
        ]);

        await token.transfer(
            await emission.getAddress(),
            (YEAR0_EMISSION - initCost) * TOKEN_UNIT
        );

        await setTimestamp(startTimestamp);
        await emission.emission();

        const split = primarySplitForPeriod(0, initCost);
        expect(await token.balanceOf(relayCold.address)).to.equal(split.relayAmount);
        expect(await token.balanceOf(daoTreasury.address)).to.equal(split.daoAmount);
    });

    it("reverts when initCost exceeds first DAO share", async () => {
        const ethers = await getEthers();
        const [, daoTreasury, relayCold] = await ethers.getSigners();
        const token = await ethers.deployContract("CrynuxToken");
        const latest = await ethers.provider.getBlock("latest");
        const startTimestamp = Number(latest!.timestamp) + 100;
        const initCost = 517_039_994n;

        const emission = await ethers.deployContract("EmissionERC20", [
            await token.getAddress(),
            0,
            daoTreasury.address,
            relayCold.address,
            startTimestamp,
            0,
            initCost,
        ]);

        await token.transfer(await emission.getAddress(), YEAR0_EMISSION * TOKEN_UNIT);
        await setTimestamp(startTimestamp);

        await expect(emission.emission()).to.be.revertedWith(
            "init cost exceeds dao share"
        );
    });

    it("releases 100% to relay cold wallet in mirror mode", async () => {
        const ethers = await getEthers();
        const [, daoTreasury, relayCold, caller] = await ethers.getSigners();
        const token = await ethers.deployContract("CrynuxToken");
        const latest = await ethers.provider.getBlock("latest");
        const startTimestamp = Number(latest!.timestamp) + 100;

        const emission = await ethers.deployContract("EmissionERC20", [
            await token.getAddress(),
            1,
            daoTreasury.address,
            relayCold.address,
            startTimestamp,
            0,
            0,
        ]);

        await token.transfer(await emission.getAddress(), YEAR0_EMISSION * TOKEN_UNIT);
        await setTimestamp(startTimestamp);
        await emission.connect(caller).emission();

        expect(await token.balanceOf(relayCold.address)).to.equal(
            YEAR0_EMISSION * TOKEN_UNIT
        );
        expect(await token.balanceOf(daoTreasury.address)).to.equal(0);
    });

    it("supports initialEmissionIndex for new chain catch-up start", async () => {
        const ethers = await getEthers();
        const [, daoTreasury, relayCold] = await ethers.getSigners();
        const token = await ethers.deployContract("CrynuxToken");
        const latest = await ethers.provider.getBlock("latest");
        const startTimestamp = Number(latest!.timestamp) + 100;
        const initialEmissionIndex = 53;

        const emission = await ethers.deployContract("EmissionERC20", [
            await token.getAddress(),
            1,
            daoTreasury.address,
            relayCold.address,
            startTimestamp,
            initialEmissionIndex,
            0,
        ]);

        expect(await emission.nextEmissionIndex()).to.equal(initialEmissionIndex);

        const amount = nominalEmissionForPeriod(initialEmissionIndex) * TOKEN_UNIT;
        await token.transfer(await emission.getAddress(), amount);
        await setTimestamp(startTimestamp + initialEmissionIndex * 7 * 24 * 60 * 60);
        await emission.emission();

        expect(await emission.nextEmissionIndex()).to.equal(initialEmissionIndex + 1);
        expect(await token.balanceOf(relayCold.address)).to.equal(amount);
    });

    it("exhaustively releases all periods and matches hardcoded totals", async () => {
        const ethers = await getEthers();
        const [deployer, daoTreasury, relayCold] = await ethers.getSigners();
        const token = await ethers.deployContract("CrynuxToken");
        const latest = await ethers.provider.getBlock("latest");
        const startTimestamp = Number(latest!.timestamp) + 100;

        const emission = await ethers.deployContract("EmissionERC20", [
            await token.getAddress(),
            0,
            daoTreasury.address,
            relayCold.address,
            startTimestamp,
            0,
            0,
        ]);

        const totalSupply = 8_617_333_262n * TOKEN_UNIT;
        await token
            .connect(deployer)
            .transfer(await emission.getAddress(), totalSupply);

        await setTimestamp(startTimestamp + (TOTAL_PERIODS - 1) * 7 * 24 * 60 * 60);

        let expectedDistributed = 0n;
        for (let i = 0; i < TOTAL_PERIODS; i += 1) {
            expectedDistributed += nominalEmissionForPeriod(i) * TOKEN_UNIT;
            await emission.emission();
        }

        expect(await emission.nextEmissionIndex()).to.equal(TOTAL_PERIODS);
        expect(await token.balanceOf(await emission.getAddress())).to.equal(0n);
        expect(
            (await token.balanceOf(relayCold.address)) +
                (await token.balanceOf(daoTreasury.address))
        ).to.equal(expectedDistributed);
        expect(expectedDistributed).to.equal(totalSupply);

        await expect(emission.emission()).to.be.revertedWith("all emissions completed");
    });
});
