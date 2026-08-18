import { createHash, randomBytes } from "node:crypto";
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import {
  DataSource,
  IsNull,
  MoreThan,
  QueryFailedError,
  Repository,
} from "typeorm";
import { User, UserStatus } from "./entities/user.entity";
import { TonProofChallenge } from "./entities/ton-proof-challenge.entity";
import {
  TonNetwork,
  TonWalletBinding,
} from "./entities/ton-wallet-binding.entity";
import {
  TonProofChallengeResponse,
  TonWalletBindingResponse,
  VerifyTonWalletDto,
} from "./ton-wallet.dto";
import {
  TonProofVerificationError,
  TonProofVerifier,
} from "./ton-proof-verifier";

interface TonConnectConfig {
  domain: string;
  network: TonNetwork;
  challengeTtlSeconds: number;
  futureSkewSeconds: number;
}

@Injectable()
export class TonWalletService {
  private readonly logger = new Logger(TonWalletService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(TonProofChallenge)
    private readonly challengeRepository: Repository<TonProofChallenge>,
    @InjectRepository(TonWalletBinding)
    private readonly walletRepository: Repository<TonWalletBinding>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly verifier: TonProofVerifier,
  ) {}

  async issueChallenge(userId: string): Promise<TonProofChallengeResponse> {
    const config = this.getConfig();
    if (
      !(await this.userRepository.exist({
        where: { id: userId, status: UserStatus.ACTIVE, deletedAt: IsNull() },
      }))
    ) {
      throw new NotFoundException("User not found");
    }

    const payload = randomBytes(32).toString("base64url");
    const payloadHash = hashPayload(payload);
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + config.challengeTtlSeconds * 1_000,
    );

    await this.dataSource.transaction(async (manager) => {
      // Only the newest challenge remains usable for this account. This keeps
      // wallet reconnect/retry behaviour deterministic across web and Mini App.
      await manager.update(
        TonProofChallenge,
        { userId, consumedAt: IsNull() },
        { consumedAt: now },
      );
      await manager.save(
        manager.create(TonProofChallenge, {
          userId,
          payloadHash,
          expiresAt,
          consumedAt: null,
        }),
      );
    });

    return { payload, expiresAt: expiresAt.toISOString() };
  }

  async verifyAndBind(
    userId: string,
    input: VerifyTonWalletDto,
  ): Promise<TonWalletBindingResponse> {
    const config = this.getConfig();
    const now = new Date();
    if (
      !(await this.userRepository.exist({
        where: { id: userId, status: UserStatus.ACTIVE, deletedAt: IsNull() },
      }))
    ) {
      throw new UnauthorizedException("TON wallet proof verification failed");
    }
    const payloadHash = hashPayload(input.proof.payload);
    const challenge = await this.challengeRepository.findOne({
      where: {
        userId,
        payloadHash,
        consumedAt: IsNull(),
        expiresAt: MoreThan(now),
      },
    });
    if (!challenge) {
      throw new UnauthorizedException("TON wallet proof verification failed");
    }

    let verified: ReturnType<TonProofVerifier["verify"]>;
    try {
      verified = this.verifier.verify(input.account, input.proof, {
        expectedDomain: config.domain,
        expectedNetwork: config.network,
        expectedPayload: input.proof.payload,
        maxAgeSeconds: config.challengeTtlSeconds,
        futureSkewSeconds: config.futureSkewSeconds,
      });
    } catch (error) {
      if (error instanceof TonProofVerificationError) {
        this.logger.warn(
          `Rejected TON wallet proof for user=${userId}: ${error.message}`,
        );
        throw new UnauthorizedException("TON wallet proof verification failed");
      }
      throw error;
    }

    try {
      const binding = await this.dataSource.transaction(async (manager) => {
        const consumed = await manager.update(
          TonProofChallenge,
          {
            id: challenge.id,
            consumedAt: IsNull(),
            expiresAt: MoreThan(now),
          },
          { consumedAt: now },
        );
        if (consumed.affected !== 1) {
          throw new UnauthorizedException(
            "TON wallet proof verification failed",
          );
        }

        const addressOwner = await manager.findOne(TonWalletBinding, {
          where: { network: verified.network, address: verified.address },
        });
        if (addressOwner && addressOwner.userId !== userId) {
          throw new ConflictException(
            "This TON wallet is already attached to another account",
          );
        }

        let target = await manager.findOne(TonWalletBinding, {
          where: { userId, network: verified.network },
        });
        if (!target) {
          target = manager.create(TonWalletBinding, {
            userId,
            network: verified.network,
            address: verified.address,
            publicKey: verified.publicKey,
            walletStateInit: verified.walletStateInit,
            verifiedAt: now,
          });
        } else {
          target.address = verified.address;
          target.publicKey = verified.publicKey;
          target.walletStateInit = verified.walletStateInit;
          target.verifiedAt = now;
        }
        return manager.save(target);
      });

      this.logger.log(
        `TON wallet verified: user=${userId} network=${binding.network} wallet=${binding.address}`,
      );
      return toResponse(binding);
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof UnauthorizedException
      ) {
        throw error;
      }
      if (isUniqueConstraintViolation(error)) {
        throw new ConflictException(
          "This TON wallet is already attached to another account",
        );
      }
      throw error;
    }
  }

  async getBinding(userId: string): Promise<TonWalletBindingResponse | null> {
    const config = this.getConfig();
    const binding = await this.walletRepository.findOne({
      where: { userId, network: config.network },
    });
    return binding ? toResponse(binding) : null;
  }

  async detach(userId: string): Promise<void> {
    const config = this.getConfig();
    await this.walletRepository.delete({ userId, network: config.network });
    this.logger.log(
      `TON wallet detached: user=${userId} network=${config.network}`,
    );
  }

  private getConfig(): TonConnectConfig {
    if (this.configService.get("TON_CONNECT_ENABLED", "false") !== "true") {
      throw new ServiceUnavailableException("TON Connect is not enabled");
    }

    const domain = this.configService
      .get<string>("TON_CONNECT_PROOF_DOMAIN", "")
      .trim();
    if (
      !domain ||
      Buffer.byteLength(domain, "utf8") > 128 ||
      /:\/\/|[\s/?#]/.test(domain)
    ) {
      throw new ServiceUnavailableException(
        "TON Connect proof domain is not configured safely",
      );
    }

    const network = this.configService.get<string>("TON_CONNECT_NETWORK", "");
    if (network !== TonNetwork.MAINNET && network !== TonNetwork.TESTNET) {
      throw new ServiceUnavailableException(
        "TON Connect network is not configured safely",
      );
    }

    return {
      domain,
      network,
      challengeTtlSeconds: parseBoundedInteger(
        this.configService.get("TON_CONNECT_PROOF_TTL_SECONDS", "300"),
        60,
        900,
        "TON Connect proof TTL",
      ),
      futureSkewSeconds: parseBoundedInteger(
        this.configService.get("TON_CONNECT_FUTURE_SKEW_SECONDS", "30"),
        0,
        120,
        "TON Connect future skew",
      ),
    };
  }
}

function hashPayload(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function toResponse(binding: TonWalletBinding): TonWalletBindingResponse {
  return {
    address: binding.address,
    network: binding.network,
    publicKey: binding.publicKey,
    verifiedAt: binding.verifiedAt.toISOString(),
  };
}

function parseBoundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ServiceUnavailableException(`${label} is not configured safely`);
  }
  return parsed;
}

function isUniqueConstraintViolation(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = error.driverError as { code?: string } | undefined;
  return (
    driverError?.code === "23505" || driverError?.code === "SQLITE_CONSTRAINT"
  );
}
