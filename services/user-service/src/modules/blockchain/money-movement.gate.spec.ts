import { ConfigService } from '@nestjs/config';
import {
  MoneyMovementDisabledError,
  MoneyMovementGate,
} from './money-movement.gate';

function makeConfig(value?: string | boolean): ConfigService {
  return {
    get: jest.fn((_key: string, fallback: string | boolean) => value ?? fallback),
  } as unknown as ConfigService;
}

describe('MoneyMovementGate', () => {
  it.each([undefined, false, 'false', 'TRUE', '1', 'replace_me'])
    ('fails closed for MONEY_EGRESS_ENABLED=%p', (value) => {
      const gate = new MoneyMovementGate(makeConfig(value));

      expect(gate.isEnabled).toBe(false);
      expect(() => gate.assertRelayOperationAllowed('erc20.transfer 10→0xabc')).toThrow(
        MoneyMovementDisabledError,
      );
    });

  it.each([true, 'true'])('allows relay writes only for explicit true value %p', (value) => {
    const gate = new MoneyMovementGate(makeConfig(value));

    expect(gate.isEnabled).toBe(true);
    expect(() => gate.assertRelayOperationAllowed('erc20.transfer 10→0xabc')).not.toThrow();
  });

  it('emits a stable error code without including queue-sensitive details', () => {
    const gate = new MoneyMovementGate(makeConfig(false));

    try {
      gate.assertRelayOperationAllowed('erc20.transfer 10→0x1234567890abcdef');
      fail('expected safety stop to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(MoneyMovementDisabledError);
      expect(error).toMatchObject({ code: 'MONEY_EGRESS_DISABLED' });
      expect((error as Error).message).not.toContain('0x1234567890abcdef');
      expect((error as Error).message).not.toContain('10');
    }
  });
});
