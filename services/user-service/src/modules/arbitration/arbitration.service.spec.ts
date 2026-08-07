import { ForbiddenException } from '@nestjs/common';
import { ArbitrationService } from './arbitration.service';

describe('ArbitrationService decision access policy', () => {
  const decisionRepository = { findOne: jest.fn() };
  const disputeService = { getDisputeForUser: jest.fn() };

  const service = new ArbitrationService(
    decisionRepository as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    disputeService as any,
    {} as any,
    {} as any,
    {} as any,
  );

  beforeEach(() => jest.clearAllMocks());

  it('does not return a decision when the associated dispute rejects the actor', async () => {
    decisionRepository.findOne.mockResolvedValue({ id: 'decision-1', disputeId: 'dispute-1' });
    disputeService.getDisputeForUser.mockRejectedValue(new ForbiddenException('Access denied'));

    await expect(service.getDecision('decision-1', 'outsider-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(disputeService.getDisputeForUser).toHaveBeenCalledWith('dispute-1', 'outsider-1', []);
  });
});
