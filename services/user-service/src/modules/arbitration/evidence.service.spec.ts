import { ForbiddenException } from '@nestjs/common';
import { EvidenceService } from './evidence.service';
import { EvidenceType } from './entities/enums/arbitration.enum';

describe('EvidenceService access policy', () => {
  const evidenceRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
  };
  const disputeRepository = { findOne: jest.fn() };
  const userRepository = {};
  const settingsService = {
    getMaxEvidencePerDispute: jest.fn(),
    getMaxEvidenceFileSizeMb: jest.fn(),
    getAllowedFileTypes: jest.fn(),
  };
  const disputeService = { getDisputeForUser: jest.fn() };

  const service = new EvidenceService(
    evidenceRepository as any,
    disputeRepository as any,
    userRepository as any,
    settingsService as any,
    disputeService as any,
  );

  beforeEach(() => jest.clearAllMocks());

  it('checks dispute access before returning evidence', async () => {
    const evidence = { id: 'evidence-1', disputeId: 'dispute-1' };
    evidenceRepository.findOne.mockResolvedValue(evidence);

    await expect(service.getEvidence('evidence-1', 'buyer-1')).resolves.toBe(evidence);
    expect(disputeService.getDisputeForUser).toHaveBeenCalledWith('dispute-1', 'buyer-1', []);
  });

  it('does not return evidence when the dispute policy denies the actor', async () => {
    evidenceRepository.findOne.mockResolvedValue({ id: 'evidence-1', disputeId: 'dispute-1' });
    disputeService.getDisputeForUser.mockRejectedValue(new ForbiddenException('Access denied'));

    await expect(service.getEvidence('evidence-1', 'outsider-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('does not treat a dispute ID as proof that the caller is a dispute party', async () => {
    disputeRepository.findOne.mockResolvedValue({
      id: 'dispute-1',
      isClosed: false,
      openerId: 'opener-1',
      arbitratorId: null,
      deal: { buyerId: 'buyer-1', sellerId: 'seller-1' },
    });

    await expect(
      service.submitEvidence('dispute-1', 'outsider-1', {
        type: EvidenceType.FILE,
        description: 'not allowed',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(evidenceRepository.save).not.toHaveBeenCalled();
  });

  it('fails closed instead of accepting file bytes without managed storage', async () => {
    await expect(
      service.uploadFileEvidence(
        'dispute-1',
        'buyer-1',
        { size: 1, mimetype: 'image/png', buffer: Buffer.from('x') } as any,
        'evidence',
        EvidenceType.FILE,
      ),
    ).rejects.toThrow(/disabled until managed storage/);
  });
});
