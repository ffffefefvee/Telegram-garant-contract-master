import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createHash } from "crypto";
import { DataSource, Repository } from "typeorm";
import {
  AuditExportCheckpoint,
  AuditExportReceipt,
} from "./entities/audit-export.entity";
import { AuditLogEntry } from "./entities/audit-log.entity";

const ZERO_HASH = "0".repeat(64);
const CHECKPOINT_ID = "primary";

export interface AuditWormEnvelope {
  version: 1;
  manifest: {
    firstSequence: string;
    lastSequence: string;
    recordCount: number;
    previousManifestHash: string;
    recordsHash: string;
    manifestHash: string;
  };
  records: Array<Record<string, unknown>>;
}

@Injectable()
export class AuditWormService {
  private readonly logger = new Logger(AuditWormService.name);
  private readonly client: S3Client;

  constructor(
    @InjectRepository(AuditLogEntry)
    private readonly auditEntries: Repository<AuditLogEntry>,
    @InjectRepository(AuditExportCheckpoint)
    private readonly checkpoints: Repository<AuditExportCheckpoint>,
    @InjectRepository(AuditExportReceipt)
    private readonly receipts: Repository<AuditExportReceipt>,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {
    const endpoint = config.get<string>("AUDIT_WORM_S3_ENDPOINT")?.trim();
    this.client = new S3Client({
      region: config.get<string>("AUDIT_WORM_S3_REGION", "us-east-1"),
      endpoint: endpoint || undefined,
      forcePathStyle: Boolean(endpoint),
    });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async scheduledExport(): Promise<void> {
    if (this.config.get("AUDIT_WORM_EXPORT_ENABLED") !== "true") return;
    try {
      await this.exportNextBatch();
    } catch (error) {
      this.logger.error(`WORM audit export failed: ${(error as Error).message}`);
    }
  }

  async exportNextBatch(): Promise<AuditExportReceipt | null> {
    this.assertConfigured();
    const checkpoint = await this.loadCheckpoint();
    const limit = Number(this.config.get("AUDIT_WORM_BATCH_SIZE", 500));
    const rows = await this.auditEntries
      .createQueryBuilder("audit")
      .where('audit."export_sequence" > :lastSequence', {
        lastSequence: checkpoint.lastSequence,
      })
      .orderBy('audit."export_sequence"', "ASC")
      .limit(limit)
      .getMany();
    if (rows.length === 0) return null;

    const envelope = createAuditWormEnvelope(rows, checkpoint.lastManifestHash);
    const body = Buffer.from(canonicalJson(envelope), "utf8");
    const key = `audit/v1/${envelope.manifest.firstSequence}-${envelope.manifest.lastSequence}-${envelope.manifest.manifestHash}.json`;
    const destination = await this.putImmutable(key, body, envelope.manifest.manifestHash);
    const receiptObjectKey = await this.putExternalReceipt({
      objectKey: key,
      manifestHash: envelope.manifest.manifestHash,
      versionId: destination.versionId,
      etag: destination.etag,
    });

    return this.dataSource.transaction(async (manager) => {
      const checkpointRepo = manager.getRepository(AuditExportCheckpoint);
      const receiptRepo = manager.getRepository(AuditExportReceipt);
      const locked = await checkpointRepo.findOne({
        where: { id: CHECKPOINT_ID },
        lock: { mode: "pessimistic_write" },
      });
      if (
        !locked ||
        locked.version !== checkpoint.version ||
        locked.lastSequence !== checkpoint.lastSequence ||
        locked.lastManifestHash !== checkpoint.lastManifestHash
      ) {
        throw new ConflictException("Audit export checkpoint advanced concurrently");
      }
      const receipt = await receiptRepo.save(
        receiptRepo.create({
          objectKey: key,
          receiptObjectKey,
          firstSequence: envelope.manifest.firstSequence,
          lastSequence: envelope.manifest.lastSequence,
          recordCount: envelope.manifest.recordCount,
          previousManifestHash: envelope.manifest.previousManifestHash,
          manifestHash: envelope.manifest.manifestHash,
          destinationVersionId: destination.versionId,
          destinationEtag: destination.etag,
        }),
      );
      locked.lastSequence = envelope.manifest.lastSequence;
      locked.lastManifestHash = envelope.manifest.manifestHash;
      locked.version = (BigInt(locked.version) + 1n).toString();
      locked.updatedAt = new Date();
      await checkpointRepo.save(locked);
      return receipt;
    });
  }

  async verifyDestination(): Promise<{
    batches: number;
    records: number;
    lastSequence: string;
    lastManifestHash: string;
  }> {
    this.assertConfigured();
    const receipts = await this.receipts.find({ order: { id: "ASC" } });
    let previousHash = ZERO_HASH;
    let lastSequence = 0n;
    let records = 0;
    for (const receipt of receipts) {
      const externalReceiptObject = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket(),
          Key: receipt.receiptObjectKey,
        }),
      );
      const externalReceiptText =
        await externalReceiptObject.Body?.transformToString();
      if (!externalReceiptText) {
        throw new Error(`External WORM receipt is empty: ${receipt.receiptObjectKey}`);
      }
      const expectedExternalReceipt = canonicalJson({
        version: 1,
        objectKey: receipt.objectKey,
        manifestHash: receipt.manifestHash,
        destinationVersionId: receipt.destinationVersionId,
        destinationEtag: receipt.destinationEtag,
      });
      if (externalReceiptText !== expectedExternalReceipt) {
        throw new Error(`External WORM receipt mismatch: ${receipt.receiptObjectKey}`);
      }
      const object = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket(),
          Key: receipt.objectKey,
          VersionId: receipt.destinationVersionId,
        }),
      );
      const text = await object.Body?.transformToString();
      if (!text) throw new Error(`WORM object is empty: ${receipt.objectKey}`);
      const envelope = JSON.parse(text) as AuditWormEnvelope;
      verifyAuditWormEnvelope(envelope, previousHash, lastSequence + 1n);
      if (
        envelope.manifest.manifestHash !== receipt.manifestHash ||
        envelope.manifest.lastSequence !== receipt.lastSequence ||
        envelope.manifest.recordCount !== receipt.recordCount
      ) {
        throw new Error(`WORM receipt mismatch: ${receipt.objectKey}`);
      }
      previousHash = envelope.manifest.manifestHash;
      lastSequence = BigInt(envelope.manifest.lastSequence);
      records += envelope.manifest.recordCount;
    }
    return {
      batches: receipts.length,
      records,
      lastSequence: lastSequence.toString(),
      lastManifestHash: previousHash,
    };
  }

  private async loadCheckpoint(): Promise<AuditExportCheckpoint> {
    let checkpoint = await this.checkpoints.findOne({ where: { id: CHECKPOINT_ID } });
    if (!checkpoint) {
      checkpoint = await this.checkpoints.save(
        this.checkpoints.create({
          id: CHECKPOINT_ID,
          lastSequence: "0",
          lastManifestHash: ZERO_HASH,
          version: "0",
          updatedAt: new Date(),
        }),
      );
    }
    return checkpoint;
  }

  private async putImmutable(key: string, body: Buffer, manifestHash: string) {
    try {
      const existing = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket(), Key: key }),
      );
      const existingBytes = await existing.Body?.transformToByteArray();
      if (
        existing.Metadata?.["manifest-hash"] !== manifestHash ||
        !existingBytes ||
        !Buffer.from(existingBytes).equals(body)
      ) {
        throw new Error("Existing WORM key has different immutable content");
      }
      if (!existing.VersionId || !existing.ETag) {
        throw new Error("Existing WORM object lacks version receipt metadata");
      }
      return { versionId: existing.VersionId, etag: existing.ETag };
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (
        status !== 404 &&
        !["NotFound", "NoSuchKey"].includes((error as Error).name)
      ) {
        throw error;
      }
    }
    const retentionDays = Number(
      this.config.get("AUDIT_WORM_RETENTION_DAYS", 2555),
    );
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket(),
        Key: key,
        Body: body,
        ContentType: "application/json",
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: this.required("AUDIT_WORM_S3_KMS_KEY_ID"),
        ObjectLockMode: "COMPLIANCE",
        ObjectLockRetainUntilDate: new Date(
          Date.now() + retentionDays * 24 * 60 * 60 * 1000,
        ),
        ChecksumSHA256: createHash("sha256").update(body).digest("base64"),
        Metadata: { "manifest-hash": manifestHash },
      }),
    );
    if (!result.VersionId || !result.ETag) {
      throw new Error("WORM destination did not return version and ETag receipts");
    }
    return { versionId: result.VersionId, etag: result.ETag };
  }

  private async putExternalReceipt(input: {
    objectKey: string;
    manifestHash: string;
    versionId: string;
    etag: string;
  }): Promise<string> {
    const key = `audit-receipts/v1/${input.manifestHash}.json`;
    const body = Buffer.from(
      canonicalJson({
        version: 1,
        objectKey: input.objectKey,
        manifestHash: input.manifestHash,
        destinationVersionId: input.versionId,
        destinationEtag: input.etag,
      }),
      "utf8",
    );
    const retentionDays = Number(
      this.config.get("AUDIT_WORM_RETENTION_DAYS", 2555),
    );
    try {
      const existing = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket(), Key: key }),
      );
      const existingBytes = await existing.Body?.transformToByteArray();
      if (
        existing.Metadata?.["manifest-hash"] !== input.manifestHash ||
        existing.Metadata?.kind !== "receipt" ||
        !existingBytes ||
        !Buffer.from(existingBytes).equals(body)
      ) {
        throw new Error("Existing external WORM receipt has different content");
      }
      return key;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (
        status !== 404 &&
        !["NotFound", "NoSuchKey"].includes((error as Error).name)
      ) {
        throw error;
      }
    }
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket(),
        Key: key,
        Body: body,
        ContentType: "application/json",
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: this.required("AUDIT_WORM_S3_KMS_KEY_ID"),
        ObjectLockMode: "COMPLIANCE",
        ObjectLockRetainUntilDate: new Date(
          Date.now() + retentionDays * 24 * 60 * 60 * 1000,
        ),
        ChecksumSHA256: createHash("sha256").update(body).digest("base64"),
        Metadata: { "manifest-hash": input.manifestHash, kind: "receipt" },
      }),
    );
    return key;
  }

  private assertConfigured(): void {
    if (this.config.get("AUDIT_WORM_EXPORT_ENABLED") !== "true") {
      throw new ServiceUnavailableException("WORM audit export is disabled");
    }
    this.bucket();
    this.required("AUDIT_WORM_S3_KMS_KEY_ID");
  }

  private bucket(): string {
    return this.required("AUDIT_WORM_S3_BUCKET");
  }

  private required(key: string): string {
    const value = this.config.get<string>(key)?.trim();
    if (!value) throw new ServiceUnavailableException(`${key} is not configured`);
    return value;
  }
}

export function createAuditWormEnvelope(
  rows: AuditLogEntry[],
  previousManifestHash: string,
): AuditWormEnvelope {
  const records = rows.map((row) => ({
    sequence: row.exportSequence,
    id: row.id,
    actorId: row.actorId,
    actorRole: row.actorRole,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    action: row.action,
    details: row.details,
    createdAt: row.createdAt.toISOString(),
  }));
  const recordsHash = hashCanonical(records);
  const unsigned = {
    firstSequence: rows[0].exportSequence,
    lastSequence: rows[rows.length - 1].exportSequence,
    recordCount: rows.length,
    previousManifestHash,
    recordsHash,
  };
  const manifestHash = hashCanonical({ version: 1, ...unsigned });
  return { version: 1, manifest: { ...unsigned, manifestHash }, records };
}

export function verifyAuditWormEnvelope(
  envelope: AuditWormEnvelope,
  expectedPreviousHash: string,
  expectedFirstSequence: bigint,
): void {
  if (envelope.version !== 1 || envelope.records.length === 0) {
    throw new Error("Invalid WORM audit envelope");
  }
  const sequences = envelope.records.map((record) => BigInt(String(record.sequence)));
  for (let index = 0; index < sequences.length; index += 1) {
    if (sequences[index] !== expectedFirstSequence + BigInt(index)) {
      throw new Error("WORM audit sequence gap, duplicate or reordering detected");
    }
  }
  const expectedManifest = {
    firstSequence: sequences[0].toString(),
    lastSequence: sequences[sequences.length - 1].toString(),
    recordCount: envelope.records.length,
    previousManifestHash: expectedPreviousHash,
    recordsHash: hashCanonical(envelope.records),
  };
  const expectedHash = hashCanonical({ version: 1, ...expectedManifest });
  if (
    canonicalJson({ ...envelope.manifest, manifestHash: undefined }) !==
      canonicalJson({ ...expectedManifest, manifestHash: undefined }) ||
    envelope.manifest.manifestHash !== expectedHash
  ) {
    throw new Error("WORM audit manifest or hash chain verification failed");
  }
}

function hashCanonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
    .join(",")}}`;
}
