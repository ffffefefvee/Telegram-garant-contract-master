import { ReputationService } from './reputation.service';
import { ReputationEventType } from './enums/review.enum';

describe('ReputationService', () => {
  const reputationRepository = {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
  };
  const userRepository = {
    findOne: jest.fn(),
    save: jest.fn(async (value) => value),
  };

  let service: ReputationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ReputationService(reputationRepository as any, userRepository as any);
  });

  it('normalizes decimal reputation values before writing integer score history', async () => {
    userRepository.findOne.mockResolvedValue({
      id: 'user-1',
      reputationScore: '0.00',
    });

    await service.addScoreChange('user-1', ReputationEventType.DEAL_COMPLETED, 2);

    expect(reputationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        scoreBefore: 0,
        scoreAfter: 2,
      }),
    );
    expect(userRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        reputationScore: 2,
      }),
    );
  });
});
