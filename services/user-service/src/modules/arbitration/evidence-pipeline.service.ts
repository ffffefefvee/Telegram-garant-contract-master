import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { createHash, randomUUID } from "crypto";
import { DataSource, Repository } from "typeorm";
import { AuditLogService } from "../ops/audit-log.service";
import { UserType } from "../user/entities/user.entity";
import { ArbitrationSettingsService } from "./arbitration-settings.service";
import { DisputeService } from "./dispute.service";
import { EvidenceFileManifest } from "./entities/evidence-file-manifest.entity";
import { Dispute } from "./entities/dispute.entity";
import { Evidence } from "./entities/evidence.entity";
import { EvidenceType } from "./entities/enums/arbitration.enum";
import { inspectEvidenceFile } from "./evidence-file-policy";
import {
  EVIDENCE_MALWARE_SCANNER,
  EVIDENCE_OBJECT_STORAGE,
  EvidenceMalwareScanner,
  EvidenceObjectStorage,
} from "./evidence-pipeline.ports";

const DOWNLOAD_TTL_SECONDS = 300;
const RETENTION_DAYS = 365;

@Injectable()
export class EvidencePipelineService {
  constructor(
    @InjectRepository(Evidence)
    private readonly evidenceRepository: Repository<Evidence>,
    @InjectRepository(EvidenceFileManifest)
    private readonly manifestRepository: Repository<EvidenceFileManifest>,
    @InjectRepository(Dispute)
    private readonly disputeRepository: Repository<Dispute>,
    private readonly settings: ArbitrationSettingsService,
    private readonly disputeService: DisputeService,
    private readonly dataSource: DataSource,
    private readonly audit: AuditLogService,
    @Inject(EVIDENCE_OBJECT_STORAGE)
    private readonly storage: EvidenceObjectStorage,
    @Inject(EVIDENCE_MALWARE_SCANNER)
    private readonly scanner: EvidenceMalwareScanner,
  ) {}

  async upload(input: {
    disputeId: string;
    userId: string;
    description: string;
    type: EvidenceType;
    file: Express.Multer.File;
  }): Promise<Evidence> {
    const dispute = await this.assertSubmissionAllowed(input.disputeId, input.userId);
    const description = input.description?.trim();
    if (!description || description.length > 2000) {
      throw new BadRequestException("Evidence description must be 1-2000 characters");
    }
    if (!isFileEvidenceType(input.type)) {
      throw new BadRequestException("Evidence type is not a file type");
    }

    const maxBytes = (await this.settings.getMaxEvidenceFileSizeMb()) * 1024 * 1024;
    const configuredMediaTypes = await this.settings.getAllowedFileTypes();
    const inspected = inspectEvidenceFile({
      originalName: input.file.originalname,
      declaredMediaType: input.file.mimetype,
      bytes: input.file.buffer,
      configuredMaxBytes: maxBytes,
      configuredMediaTypes,
    });

    const quarantineKey = `quarantine/${input.disputeId}/${randomUUID()}`;
    await this.storage.putQuarantined({
      key: quarantineKey,
      bytes: input.file.buffer,
      mediaType: inspected.mediaType,
    });

    let promotedKey: string | null = null;
    try {
      const scan = await this.scanner.scan({
        bytes: input.file.buffer,
        mediaType: inspected.mediaType,
      });
      if (!scan.clean) {
        throw new UnsupportedMediaTypeException(
          "Evidence file did not pass malware scanning",
        );
      }
      assertScanMetadata(scan);

      // The content commitment is deliberately calculated only after the
      // scanner accepted the exact bytes that will be promoted.
      const sha256 = hash(input.file.buffer);
      if (scan.sha256 !== sha256) {
        throw new UnsupportedMediaTypeException(
          "Malware scan result does not match the uploaded bytes",
        );
      }
      promotedKey = await this.storage.promoteClean({ quarantineKey, sha256 });
      const scannedAt = new Date(scan.scannedAt);
      const retentionUntil = new Date(
        scannedAt.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000,
      );
      const scanEvidenceHash = hash(Buffer.from(scan.evidence, "utf8"));

      const result = await this.dataSource.transaction(async (manager) => {
        const evidenceRepo = manager.getRepository(Evidence);
        const manifestRepo = manager.getRepository(EvidenceFileManifest);
        const evidence = await evidenceRepo.save(
          evidenceRepo.create({
            disputeId: dispute.id,
            submittedById: input.userId,
            type: input.type,
            description,
            content: null,
            fileName: inspected.originalName,
            filePath: null,
            fileType: inspected.mediaType,
            fileSize: inspected.size,
            fileHash: sha256,
            metadata: null,
          }),
        );
        const manifestHash = hashManifest({
          evidenceId: evidence.id,
          storageKey: promotedKey!,
          mediaType: inspected.mediaType,
          size: inspected.size,
          sha256,
          scannerName: scan.scannerName,
          scannerVersion: scan.scannerVersion,
          scannerPolicyVersion: scan.policyVersion,
          scannerResultId: scan.resultId,
          scanEvidenceHash,
          scannedAt,
          retentionUntil,
        });
        await manifestRepo.save(
          manifestRepo.create({
            evidenceId: evidence.id,
            storageKey: promotedKey!,
            mediaType: inspected.mediaType,
            size: String(inspected.size),
            sha256,
            scannerName: scan.scannerName,
            scannerVersion: scan.scannerVersion,
            scannerPolicyVersion: scan.policyVersion,
            scannerResultId: scan.resultId,
            scanEvidenceHash,
            manifestHash,
            scannedAt,
            retentionUntil,
            deletedAt: null,
            deletionReason: null,
          }),
        );
        await this.audit.writeRequired({
          actorId: input.userId,
          actorRole: "dispute_party",
          aggregateType: "evidence",
          aggregateId: evidence.id,
          action: "EVIDENCE_FILE_ACCEPTED",
          details: { disputeId: dispute.id, sha256, manifestHash },
          manager,
        });
        return evidence;
      });
      return result;
    } catch (error) {
      await this.storage.delete(promotedKey ?? quarantineKey).catch(() => undefined);
      throw error;
    }
  }

  async createDownloadUrl(
    evidenceId: string,
    userId: string,
    roles: UserType[] = [],
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const evidence = await this.evidenceRepository.findOne({
      where: { id: evidenceId },
    });
    if (!evidence) throw new NotFoundException("Evidence not found");
    await this.disputeService.getDisputeForUser(
      evidence.disputeId,
      userId,
      roles,
    );
    const manifest = await this.manifestRepository.findOne({
      where: { evidenceId },
    });
    if (!manifest || manifest.deletedAt) {
      throw new NotFoundException("Evidence file is not available");
    }
    return {
      url: await this.storage.createDownloadUrl({
        key: manifest.storageKey,
        expiresInSeconds: DOWNLOAD_TTL_SECONDS,
      }),
      expiresInSeconds: DOWNLOAD_TTL_SECONDS,
    };
  }

  private async assertSubmissionAllowed(
    disputeId: string,
    userId: string,
  ): Promise<Dispute> {
    const dispute = await this.disputeRepository.findOne({
      where: { id: disputeId },
      relations: ["deal"],
    });
    if (!dispute) throw new NotFoundException("Dispute not found");
    if (dispute.isClosed) {
      throw new ForbiddenException("Cannot submit evidence to closed dispute");
    }
    const isParty =
      dispute.openerId === userId ||
      dispute.deal?.buyerId === userId ||
      dispute.deal?.sellerId === userId ||
      dispute.arbitratorId === userId;
    if (!isParty) {
      throw new ForbiddenException("You cannot submit evidence to this dispute");
    }
    const [maximum, existing] = await Promise.all([
      this.settings.getMaxEvidencePerDispute(),
      this.evidenceRepository.count({ where: { disputeId } }),
    ]);
    if (existing >= maximum) {
      throw new ForbiddenException(`Maximum evidence limit reached: ${maximum}`);
    }
    return dispute;
  }
}

function isFileEvidenceType(type: EvidenceType): boolean {
  return [
    EvidenceType.SCREENSHOT,
    EvidenceType.VIDEO,
    EvidenceType.FILE,
    EvidenceType.AUDIO,
  ].includes(type);
}

function assertScanMetadata(scan: {
  sha256: string;
  scannerName: string;
  scannerVersion: string;
  policyVersion: string;
  scannedAt: string;
  resultId: string;
  evidence: string;
}): void {
  if (
    !scan.scannerName?.trim() ||
    !scan.scannerVersion?.trim() ||
    !scan.policyVersion?.trim() ||
    !scan.resultId?.trim() ||
    !scan.evidence?.trim() ||
    !/^[0-9a-f]{64}$/.test(scan.sha256) ||
    !Number.isFinite(new Date(scan.scannedAt).getTime()) ||
    scan.scannerName.length > 100 ||
    scan.scannerVersion.length > 128 ||
    scan.policyVersion.length > 128 ||
    scan.resultId.length > 128
  ) {
    throw new BadRequestException("Malware scanner returned incomplete evidence");
  }
}

function hash(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashManifest(input: Record<string, unknown>): string {
  const canonical = Object.keys(input)
    .sort()
    .map((key) => `${key}=${normalizeManifestValue(input[key])}`)
    .join("\n");
  return hash(Buffer.from(`EVIDENCE_FILE_MANIFEST_V1\n${canonical}`, "utf8"));
}

function normalizeManifestValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
