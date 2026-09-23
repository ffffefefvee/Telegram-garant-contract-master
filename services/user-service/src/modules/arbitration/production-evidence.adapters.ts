import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash, createPublicKey, randomUUID, verify } from "crypto";
import {
  EvidenceMalwareScanner,
  EvidenceObjectStorage,
} from "./evidence-pipeline.ports";

interface SignedScanResponse {
  requestId: string;
  resultId: string;
  clean: boolean;
  sha256: string;
  scannerName: string;
  scannerVersion: string;
  policyVersion: string;
  scannedAt: string;
  evidence: string;
  signature: string;
}

@Injectable()
export class S3EvidenceObjectStorage implements EvidenceObjectStorage {
  private readonly client: S3Client;
  private readonly quarantineBucket: string;
  private readonly cleanBucket: string;
  private readonly kmsKeyId: string;

  constructor(private readonly config: ConfigService) {
    this.quarantineBucket = config.get<string>("EVIDENCE_S3_QUARANTINE_BUCKET", "");
    this.cleanBucket = config.get<string>("EVIDENCE_S3_CLEAN_BUCKET", "");
    this.kmsKeyId = config.get<string>("EVIDENCE_S3_KMS_KEY_ID", "");
    const endpoint = config.get<string>("EVIDENCE_S3_ENDPOINT")?.trim();
    this.client = new S3Client({
      region: config.get<string>("EVIDENCE_S3_REGION", "us-east-1"),
      endpoint: endpoint || undefined,
      forcePathStyle: Boolean(endpoint),
    });
  }

  async putQuarantined(input: {
    key: string;
    bytes: Buffer;
    mediaType: string;
  }): Promise<void> {
    this.assertConfigured();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.quarantineBucket,
        Key: input.key,
        Body: input.bytes,
        ContentType: input.mediaType,
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: this.kmsKeyId,
        Metadata: { sha256: sha256(input.bytes), state: "quarantine" },
      }),
    );
  }

  async promoteClean(input: {
    quarantineKey: string;
    sha256: string;
  }): Promise<string> {
    this.assertConfigured();
    const cleanKey = `clean/${input.sha256}/${randomUUID()}`;
    const source = `${this.quarantineBucket}/${encodeS3Key(input.quarantineKey)}`;
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.cleanBucket,
        Key: cleanKey,
        CopySource: source,
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: this.kmsKeyId,
        MetadataDirective: "REPLACE",
        Metadata: { sha256: input.sha256, state: "clean" },
      }),
    );
    const head = await this.client.send(
      new HeadObjectCommand({ Bucket: this.cleanBucket, Key: cleanKey }),
    );
    if (head.Metadata?.sha256 !== input.sha256 || head.Metadata?.state !== "clean") {
      await this.client
        .send(new DeleteObjectCommand({ Bucket: this.cleanBucket, Key: cleanKey }))
        .catch(() => undefined);
      throw new BadGatewayException("Promoted evidence object failed hash binding");
    }
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.quarantineBucket,
        Key: input.quarantineKey,
      }),
    );
    return cleanKey;
  }

  async delete(key: string): Promise<void> {
    this.assertConfigured();
    const bucket = key.startsWith("quarantine/")
      ? this.quarantineBucket
      : this.cleanBucket;
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  async createDownloadUrl(input: {
    key: string;
    expiresInSeconds: number;
  }): Promise<string> {
    this.assertConfigured();
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.cleanBucket, Key: input.key }),
      { expiresIn: input.expiresInSeconds },
    );
  }

  private assertConfigured(): void {
    if (!this.quarantineBucket || !this.cleanBucket || !this.kmsKeyId) {
      throw new ServiceUnavailableException(
        "Managed evidence object storage is not configured",
      );
    }
  }
}

@Injectable()
export class AuthenticatedEvidenceMalwareScanner
  implements EvidenceMalwareScanner
{
  constructor(private readonly config: ConfigService) {}

  async scan(input: { bytes: Buffer; mediaType: string }) {
    const requestId = randomUUID();
    const expectedSha256 = sha256(input.bytes);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Number(this.config.get("EVIDENCE_SCANNER_TIMEOUT_MS", 30_000)),
    );
    let response: Response;
    try {
      response = await fetch(required(this.config, "EVIDENCE_SCANNER_URL"), {
        method: "POST",
        headers: {
          authorization: `Bearer ${required(this.config, "EVIDENCE_SCANNER_API_TOKEN")}`,
          "content-type": "application/json",
          "x-evidence-request-id": requestId,
        },
        body: JSON.stringify({
          requestId,
          mediaType: input.mediaType,
          sha256: expectedSha256,
          contentBase64: input.bytes.toString("base64"),
        }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new ServiceUnavailableException(
        `Evidence scanner unavailable: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Evidence scanner returned HTTP ${response.status}`,
      );
    }
    const result = (await response.json()) as SignedScanResponse;
    this.verifyResult(result, { requestId, expectedSha256 });
    return {
      clean: result.clean,
      sha256: result.sha256,
      scannerName: result.scannerName,
      scannerVersion: result.scannerVersion,
      policyVersion: result.policyVersion,
      scannedAt: result.scannedAt,
      resultId: result.resultId,
      evidence: result.evidence,
    };
  }

  private verifyResult(
    result: SignedScanResponse,
    expected: { requestId: string; expectedSha256: string },
  ): void {
    const scannedAt = new Date(result.scannedAt);
    const maxAgeSeconds = Number(
      this.config.get("EVIDENCE_SCANNER_RESULT_MAX_AGE_SECONDS", 300),
    );
    const age = Math.abs(Date.now() - scannedAt.getTime());
    if (
      result.requestId !== expected.requestId ||
      result.sha256 !== expected.expectedSha256 ||
      !Number.isFinite(scannedAt.getTime()) ||
      age > maxAgeSeconds * 1000
    ) {
      throw new BadGatewayException("Scanner result is stale or byte-mismatched");
    }
    const canonical = canonicalScanResult(result);
    const publicKey = createPublicKey(
      Buffer.from(
        required(this.config, "EVIDENCE_SCANNER_PUBLIC_KEY_BASE64"),
        "base64",
      ).toString("utf8"),
    );
    if (
      !verify(
        null,
        Buffer.from(canonical, "utf8"),
        publicKey,
        Buffer.from(result.signature, "base64"),
      )
    ) {
      throw new BadGatewayException("Scanner result signature is invalid");
    }
  }
}

export function canonicalScanResult(result: SignedScanResponse): string {
  return [
    "EVIDENCE_SCAN_RESULT_V1",
    `requestId=${result.requestId}`,
    `resultId=${result.resultId}`,
    `clean=${result.clean}`,
    `sha256=${result.sha256}`,
    `scannerName=${result.scannerName}`,
    `scannerVersion=${result.scannerVersion}`,
    `policyVersion=${result.policyVersion}`,
    `scannedAt=${result.scannedAt}`,
    `evidence=${result.evidence}`,
  ].join("\n");
}

function required(config: ConfigService, key: string): string {
  const value = config.get<string>(key)?.trim();
  if (!value) throw new ServiceUnavailableException(`${key} is not configured`);
  return value;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function encodeS3Key(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}
