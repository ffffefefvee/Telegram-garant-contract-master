import { ForbiddenException, UnsupportedMediaTypeException } from "@nestjs/common";
import { createHash } from "crypto";
import { EvidencePipelineService } from "./evidence-pipeline.service";
import { Evidence } from "./entities/evidence.entity";
import { EvidenceType } from "./entities/enums/arbitration.enum";

const PNG = Buffer.from("89504e470d0a1a0a00000000", "hex");

describe("EvidencePipelineService", () => {
  const evidenceRepository = {
    count: jest.fn(),
    create: jest.fn((value) => ({ ...value })),
    save: jest.fn(),
    findOneOrFail: jest.fn(),
  };
  const manifestRepository = {
    create: jest.fn((value) => ({ ...value })),
    save: jest.fn(),
    findOne: jest.fn(),
  };
  const disputeRepository = { findOne: jest.fn() };
  const settings = {
    getMaxEvidencePerDispute: jest.fn(),
    getMaxEvidenceFileSizeMb: jest.fn(),
    getAllowedFileTypes: jest.fn(),
  };
  const disputeService = { getDisputeForUser: jest.fn() };
  const storage = {
    putQuarantined: jest.fn(),
    promoteClean: jest.fn(),
    delete: jest.fn(),
    createDownloadUrl: jest.fn(),
  };
  const scanner = { scan: jest.fn() };
  const audit = { writeRequired: jest.fn() };
  const manager = {
    getRepository: jest.fn((entity) =>
      entity === Evidence ? evidenceRepository : manifestRepository,
    ),
  };
  const dataSource = {
    transaction: jest.fn((callback) => callback(manager)),
  };

  const service = new EvidencePipelineService(
    evidenceRepository as any,
    manifestRepository as any,
    disputeRepository as any,
    settings as any,
    disputeService as any,
    dataSource as any,
    audit as any,
    storage as any,
    scanner as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    disputeRepository.findOne.mockResolvedValue({
      id: "dispute-1",
      isClosed: false,
      openerId: "buyer-1",
      arbitratorId: null,
      deal: { buyerId: "buyer-1", sellerId: "seller-1" },
    });
    evidenceRepository.count.mockResolvedValue(0);
    settings.getMaxEvidencePerDispute.mockResolvedValue(20);
    settings.getMaxEvidenceFileSizeMb.mockResolvedValue(10);
    settings.getAllowedFileTypes.mockResolvedValue(["image/png"]);
    storage.putQuarantined.mockResolvedValue(undefined);
    storage.promoteClean.mockResolvedValue("clean/dispute-1/object-1");
    storage.delete.mockResolvedValue(undefined);
    scanner.scan.mockResolvedValue({
      clean: true,
      sha256: createHash("sha256").update(PNG).digest("hex"),
      scannerName: "scanner-a",
      scannerVersion: "1.0.0",
      policyVersion: "policy-2026-09",
      scannedAt: new Date().toISOString(),
      resultId: "scan-result-1",
      evidence: "signed-scan-result",
    });
    evidenceRepository.save.mockImplementation(async (value) => ({
      id: "evidence-1",
      ...value,
    }));
    manifestRepository.save.mockImplementation(async (value) => value);
    audit.writeRequired.mockResolvedValue({ id: "audit-1" });
  });

  const upload = () =>
    service.upload({
      disputeId: "dispute-1",
      userId: "buyer-1",
      description: "Delivery screenshot",
      type: EvidenceType.SCREENSHOT,
      file: {
        originalname: "proof.png",
        mimetype: "image/png",
        buffer: PNG,
      } as Express.Multer.File,
    });

  it("rejects outsiders before bytes reach quarantine", async () => {
    disputeRepository.findOne.mockResolvedValue({
      id: "dispute-1",
      isClosed: false,
      openerId: "buyer-2",
      arbitratorId: null,
      deal: { buyerId: "buyer-2", sellerId: "seller-1" },
    });

    await expect(upload()).rejects.toThrow(ForbiddenException);
    expect(storage.putQuarantined).not.toHaveBeenCalled();
  });

  it("deletes quarantined malware and persists no evidence", async () => {
    scanner.scan.mockResolvedValue({
      clean: false,
      sha256: createHash("sha256").update(PNG).digest("hex"),
      scannerName: "scanner-a",
      scannerVersion: "1.0.0",
      policyVersion: "policy-2026-09",
      scannedAt: new Date().toISOString(),
      resultId: "scan-result-1",
      evidence: "infected",
    });

    await expect(upload()).rejects.toThrow(UnsupportedMediaTypeException);
    expect(storage.delete).toHaveBeenCalledWith(
      expect.stringMatching(/^quarantine\/dispute-1\//),
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it("hashes only scanned bytes and atomically persists an immutable manifest", async () => {
    const evidence = await upload();

    expect(evidence.id).toBe("evidence-1");
    expect(storage.promoteClean).toHaveBeenCalledWith({
      quarantineKey: expect.stringMatching(/^quarantine\/dispute-1\//),
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(manifestRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        evidenceId: "evidence-1",
        storageKey: "clean/dispute-1/object-1",
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        scanEvidenceHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        scannerPolicyVersion: "policy-2026-09",
        scannerResultId: "scan-result-1",
        manifestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        deletedAt: null,
      }),
    );
    expect(audit.writeRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "EVIDENCE_FILE_ACCEPTED",
        manager,
      }),
    );
  });
});
