import { ConfigService } from "@nestjs/config";
import { UnauthorizedException } from "@nestjs/common";
import { DataSource, Repository } from "typeorm";
import { User } from "./entities/user.entity";
import { TonProofChallenge } from "./entities/ton-proof-challenge.entity";
import {
  TonNetwork,
  TonWalletBinding,
} from "./entities/ton-wallet-binding.entity";
import { TonProofVerifier } from "./ton-proof-verifier";
import { VerifyTonWalletDto } from "./ton-wallet.dto";
import { TonWalletService } from "./ton-wallet.service";

describe("TonWalletService", () => {
  const userId = "00000000-0000-4000-8000-000000000001";
  const address = `0:${"a".repeat(64)}`;
  const configValues: Record<string, string> = {
    TON_CONNECT_ENABLED: "true",
    TON_CONNECT_PROOF_DOMAIN: "garant.example",
    TON_CONNECT_NETWORK: TonNetwork.TESTNET,
    TON_CONNECT_PROOF_TTL_SECONDS: "300",
    TON_CONNECT_FUTURE_SKEW_SECONDS: "30",
  };
  const input = {
    account: {
      address,
      chain: TonNetwork.TESTNET,
      publicKey: "b".repeat(64),
      walletStateInit: "dGVzdA==",
    },
    proof: {
      timestamp: 1_700_000_000,
      domain: { lengthBytes: 14, value: "garant.example" },
      payload: "challenge",
      signature: Buffer.alloc(64).toString("base64"),
    },
  } as VerifyTonWalletDto;

  let userRepository: { exist: jest.Mock };
  let challengeRepository: { findOne: jest.Mock };
  let walletRepository: { findOne: jest.Mock; delete: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let verifier: { verify: jest.Mock };
  let service: TonWalletService;

  beforeEach(() => {
    userRepository = { exist: jest.fn().mockResolvedValue(true) };
    challengeRepository = { findOne: jest.fn() };
    walletRepository = {
      findOne: jest.fn(),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    dataSource = { transaction: jest.fn() };
    verifier = {
      verify: jest.fn().mockReturnValue({
        address,
        network: TonNetwork.TESTNET,
        publicKey: "b".repeat(64),
        walletStateInit: "dGVzdA==",
        timestamp: 1_700_000_000,
      }),
    };
    const configService = {
      get: jest.fn(
        (key: string, fallback?: string) => configValues[key] ?? fallback,
      ),
    };
    service = new TonWalletService(
      userRepository as unknown as Repository<User>,
      challengeRepository as unknown as Repository<TonProofChallenge>,
      walletRepository as unknown as Repository<TonWalletBinding>,
      dataSource as unknown as DataSource,
      configService as unknown as ConfigService,
      verifier as unknown as TonProofVerifier,
    );
  });

  it("stores only a challenge digest and expires previous unused challenges", async () => {
    const manager = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      create: jest.fn((_entity, value) => value),
      save: jest.fn(async (value) => value),
    };
    dataSource.transaction.mockImplementation(async (callback) =>
      callback(manager),
    );

    const result = await service.issueChallenge(userId);

    expect(result.payload).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(manager.update).toHaveBeenCalledWith(
      TonProofChallenge,
      expect.objectContaining({ userId }),
      expect.objectContaining({ consumedAt: expect.any(Date) }),
    );
    const persisted = manager.create.mock.calls[0][1];
    expect(persisted).not.toHaveProperty("payload");
    expect(persisted.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(persisted.payloadHash).not.toBe(result.payload);
  });

  it("consumes the challenge and saves the binding in one transaction", async () => {
    challengeRepository.findOne.mockResolvedValue({
      id: "challenge-id",
      userId,
    });
    const manager = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOne: jest
        .fn()
        .mockResolvedValueOnce(null) // address has no other owner
        .mockResolvedValueOnce(null), // user has no current testnet binding
      create: jest.fn((_entity, value) => value),
      save: jest.fn(async (value) => ({
        id: "binding-id",
        createdAt: new Date(),
        updatedAt: new Date(),
        ...value,
      })),
    };
    dataSource.transaction.mockImplementation(async (callback) =>
      callback(manager),
    );

    const result = await service.verifyAndBind(userId, input);

    expect(verifier.verify).toHaveBeenCalled();
    expect(manager.update).toHaveBeenCalledWith(
      TonProofChallenge,
      expect.objectContaining({ id: "challenge-id" }),
      expect.objectContaining({ consumedAt: expect.any(Date) }),
    );
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({ userId, address, network: TonNetwork.TESTNET }),
    );
    expect(result).toEqual(
      expect.objectContaining({ address, network: TonNetwork.TESTNET }),
    );
  });

  it("rejects a concurrent replay when the atomic consume affects no row", async () => {
    challengeRepository.findOne.mockResolvedValue({
      id: "challenge-id",
      userId,
    });
    const manager = {
      update: jest.fn().mockResolvedValue({ affected: 0 }),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };
    dataSource.transaction.mockImplementation(async (callback) =>
      callback(manager),
    );

    await expect(service.verifyAndBind(userId, input)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(manager.findOne).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });
});
