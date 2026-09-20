import { Injectable, ServiceUnavailableException } from "@nestjs/common";

export const EVIDENCE_OBJECT_STORAGE = Symbol("EVIDENCE_OBJECT_STORAGE");
export const EVIDENCE_MALWARE_SCANNER = Symbol("EVIDENCE_MALWARE_SCANNER");

export interface EvidenceObjectStorage {
  putQuarantined(input: {
    key: string;
    bytes: Buffer;
    mediaType: string;
  }): Promise<void>;
  promoteClean(input: { quarantineKey: string; sha256: string }): Promise<string>;
  delete(key: string): Promise<void>;
  createDownloadUrl(input: { key: string; expiresInSeconds: number }): Promise<string>;
}

export interface EvidenceMalwareScanner {
  scan(input: { bytes: Buffer; mediaType: string }): Promise<{
    clean: boolean;
    scannerName: string;
    scannerVersion: string;
    evidence: string;
  }>;
}

@Injectable()
export class DisabledEvidenceObjectStorage implements EvidenceObjectStorage {
  private unavailable(): never {
    throw new ServiceUnavailableException(
      "Managed evidence object storage is not configured",
    );
  }

  async putQuarantined(): Promise<void> {
    return this.unavailable();
  }

  async promoteClean(): Promise<string> {
    return this.unavailable();
  }

  async delete(): Promise<void> {
    return this.unavailable();
  }

  async createDownloadUrl(): Promise<string> {
    return this.unavailable();
  }
}

@Injectable()
export class DisabledEvidenceMalwareScanner implements EvidenceMalwareScanner {
  async scan(): Promise<never> {
    throw new ServiceUnavailableException(
      "Evidence malware scanning is not configured",
    );
  }
}
