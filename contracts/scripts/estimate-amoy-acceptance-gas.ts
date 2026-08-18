import { ethers } from "hardhat";
import type { Contract, ContractTransactionReceipt, ContractTransactionResponse } from "ethers";

const RELAY_ADDRESS = "0x8a2e349a7d98b024ac892aca2ea17b764bdb62bf";
const MIN_DEAL = 3_300_000n;
const TARIFF = { threshold: 11_000_000n, flatFee: 550_000n, percentFeeBps: 500n };
const FINE = { fineBps: 1000n, fineMin: 1_100_000n, fineMax: 11_000_000n };

async function receipt(tx: ContractTransactionResponse): Promise<ContractTransactionReceipt> {
  const result = await tx.wait();
  if (!result || result.status !== 1) throw new Error(`Transaction ${tx.hash} failed`);
  return result;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const rows: Array<{ label: string; gasUsed: bigint }> = [];
  const deploy = async (name: string, args: unknown[] = []): Promise<Contract> => {
    const factory = await ethers.getContractFactory(name);
    const contract = (await factory.deploy(...args)) as unknown as Contract;
    const deployment = contract.deploymentTransaction();
    if (!deployment) throw new Error(`${name} has no deployment transaction`);
    const txReceipt = await receipt(deployment);
    rows.push({ label: `deploy:${name}`, gasUsed: txReceipt.gasUsed });
    return contract;
  };

  const token = await deploy("TestUSDT");
  const governance = await deploy("TestGovernance", [deployer.address]);
  const treasury = await deploy("PlatformTreasury", [await token.getAddress(), await governance.getAddress()]);
  const registry = await deploy("ArbitratorRegistry", [
    await token.getAddress(),
    await treasury.getAddress(),
    200_000_000n,
    100_000_000n,
    await governance.getAddress(),
  ]);
  const implementation = await deploy("EscrowImplementation");
  const factory = await deploy("EscrowFactory", [
    await implementation.getAddress(),
    await token.getAddress(),
    await treasury.getAddress(),
    await registry.getAddress(),
    RELAY_ADDRESS,
    await governance.getAddress(),
    MIN_DEAL,
    TARIFF,
    FINE,
  ]);

  const governanceContract = governance.connect(deployer) as Contract;
  const execute = async (label: string, target: Contract, role: string, account: string) => {
    const data = target.interface.encodeFunctionData("grantRole", [role, account]);
    const tx = await governanceContract.getFunction("execute")(await target.getAddress(), data);
    rows.push({ label, gasUsed: (await receipt(tx)).gasUsed });
  };
  await execute("grant:Treasury.FACTORY_ROLE", treasury, await treasury.FACTORY_ROLE(), await factory.getAddress());
  await execute("grant:Registry.FACTORY_ROLE", registry, await registry.FACTORY_ROLE(), await factory.getAddress());
  await execute("grant:Treasury.REGISTRY_ROLE", treasury, await treasury.REGISTRY_ROLE(), await registry.getAddress());
  rows.push({
    label: "mint:relay-test-usdt",
    gasUsed: (await receipt(await token.getFunction("mint")(RELAY_ADDRESS, 10_000_000n))).gasUsed,
  });

  await ethers.provider.send("hardhat_setBalance", [RELAY_ADDRESS, "0x56bc75e2d63100000"]);
  const relay = await ethers.getImpersonatedSigner(RELAY_ADDRESS);
  const relayFactory = factory.connect(relay) as Contract;
  const relayToken = token.connect(relay) as Contract;
  const seller = ethers.Wallet.createRandom().address;
  const requiredFloat = 3_575_000n;

  const runFunding = async (suffix: string) => {
    const dealId = ethers.keccak256(ethers.toUtf8Bytes(`amoy-acceptance-gas-${suffix}`));
    const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3600);
    rows.push({
      label: `acceptance:${suffix}:createEscrow`,
      gasUsed: (
        await receipt(
          await relayFactory.getFunction("createEscrow")(
            dealId,
            deployer.address,
            seller,
            MIN_DEAL,
            0,
            deadline,
          ),
        )
      ).gasUsed,
    });
    const escrowAddress = await factory.getFunction("escrowOf")(dealId);
    rows.push({
      label: `acceptance:${suffix}:transfer`,
      gasUsed: (
        await receipt(await relayToken.getFunction("transfer")(escrowAddress, requiredFloat))
      ).gasUsed,
    });
    const escrow = await ethers.getContractAt("EscrowImplementation", escrowAddress, relay);
    rows.push({
      label: `acceptance:${suffix}:notifyFunded`,
      gasUsed: (await receipt(await escrow.getFunction("notifyFunded")())).gasUsed,
    });
    return escrowAddress;
  };

  const happyEscrow = await runFunding("happy");
  const buyerEscrow = await ethers.getContractAt("EscrowImplementation", happyEscrow, deployer);
  rows.push({
    label: "acceptance:happy:release",
    gasUsed: (await receipt(await buyerEscrow.getFunction("release")())).gasUsed,
  });
  await runFunding("recovery");

  const deployerLabels = ["deploy:", "grant:", "mint:", "acceptance:happy:release"];
  const deployerGas = rows
    .filter((row) => deployerLabels.some((prefix) => row.label.startsWith(prefix)))
    .reduce((sum, row) => sum + row.gasUsed, 0n);
  const relayGas = rows
    .filter((row) => row.label.startsWith("acceptance:") && row.label !== "acceptance:happy:release")
    .reduce((sum, row) => sum + row.gasUsed, 0n);
  const totalGas = deployerGas + relayGas;
  console.log(
    JSON.stringify(
      {
        rows: rows.map((row) => ({ ...row, gasUsed: row.gasUsed.toString() })),
        deployerGas: deployerGas.toString(),
        relayGas: relayGas.toString(),
        totalGas: totalGas.toString(),
        withFiftyPercentMargin: ((totalGas * 150n) / 100n).toString(),
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
