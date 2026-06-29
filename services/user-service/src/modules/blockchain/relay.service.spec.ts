import { RelayService } from './relay.service';
import { BlockchainProvider } from './blockchain.provider';
import { Erc20Client } from './erc20.client';
import { FactoryClient } from './factory.client';
import { EscrowClient } from './escrow.client';
import { EscrowSnapshot, EscrowStatus } from './blockchain.types';

/**
 * Unit tests for the recovery-aware `forwardAndFund`. They mock the on-chain
 * clients so we can assert exactly which txs the relay broadcasts given a
 * particular escrow state — the whole point being that a retry after a
 * half-applied funding must NOT transfer USDT a second time.
 */
describe('RelayService.forwardAndFund (recovery)', () => {
  const ESCROW = '0x' + 'c'.repeat(40);
  const HOT = '0x' + 'a'.repeat(40);

  let provider: { isReady: boolean; signerAddress: string };
  let erc20: { balanceOf: jest.Mock; transfer: jest.Mock };
  let escrow: { snapshot: jest.Mock; notifyFunded: jest.Mock };
  let relay: RelayService;

  const snapshot = (over: Partial<EscrowSnapshot>): EscrowSnapshot => ({
    address: ESCROW,
    status: EscrowStatus.AWAITING_FUNDING,
    buyer: '0x' + '1'.repeat(40),
    seller: '0x' + '2'.repeat(40),
    amount: 100n,
    buyerFee: 5n,
    sellerFee: 0n,
    fundingDeadline: Math.floor(Date.now() / 1000) + 3600,
    assignedArbitrator: '0x' + '0'.repeat(40),
    balance: 0n,
    ...over,
  });

  beforeEach(() => {
    provider = { isReady: true, signerAddress: HOT };
    erc20 = { balanceOf: jest.fn(), transfer: jest.fn() };
    escrow = { snapshot: jest.fn(), notifyFunded: jest.fn() };
    relay = new RelayService(
      provider as unknown as BlockchainProvider,
      erc20 as unknown as Erc20Client,
      {} as FactoryClient,
      escrow as unknown as EscrowClient,
    );
  });

  it('transfers the required amount then notifies on a fresh escrow', async () => {
    escrow.snapshot.mockResolvedValue(snapshot({ balance: 0n }));
    erc20.balanceOf.mockResolvedValue(1_000n); // hot-wallet
    erc20.transfer.mockResolvedValue('0xtransfer');
    escrow.notifyFunded.mockResolvedValue('0xnotify');

    const result = await relay.forwardAndFund(ESCROW, 105n);

    // amount(100) + buyerFee(5) = 105 must be transferred.
    expect(erc20.transfer).toHaveBeenCalledWith(ESCROW, 105n);
    expect(escrow.notifyFunded).toHaveBeenCalledWith(ESCROW);
    expect(result).toEqual({
      transferTxHash: '0xtransfer',
      notifyTxHash: '0xnotify',
      alreadyFunded: false,
    });
  });

  it('does NOT transfer again when the clone is already FUNDED (idempotent replay)', async () => {
    escrow.snapshot.mockResolvedValue(
      snapshot({ status: EscrowStatus.FUNDED, balance: 105n }),
    );

    const result = await relay.forwardAndFund(ESCROW, 105n);

    expect(erc20.transfer).not.toHaveBeenCalled();
    expect(escrow.notifyFunded).not.toHaveBeenCalled();
    expect(result).toEqual({
      transferTxHash: null,
      notifyTxHash: null,
      alreadyFunded: true,
    });
  });

  it('completes only notifyFunded when the transfer already landed but notify failed earlier', async () => {
    // Recovery case: balance already covers required, status still AWAITING.
    escrow.snapshot.mockResolvedValue(
      snapshot({ status: EscrowStatus.AWAITING_FUNDING, balance: 105n }),
    );
    escrow.notifyFunded.mockResolvedValue('0xnotify');

    const result = await relay.forwardAndFund(ESCROW, 105n);

    expect(erc20.transfer).not.toHaveBeenCalled();
    expect(escrow.notifyFunded).toHaveBeenCalledWith(ESCROW);
    expect(result.transferTxHash).toBeNull();
    expect(result.notifyTxHash).toBe('0xnotify');
    expect(result.alreadyFunded).toBe(false);
  });

  it('transfers only the shortfall when the clone is partially funded', async () => {
    // 60 already in the clone, 105 required → transfer 45.
    escrow.snapshot.mockResolvedValue(snapshot({ balance: 60n }));
    erc20.balanceOf.mockResolvedValue(1_000n);
    erc20.transfer.mockResolvedValue('0xtransfer');
    escrow.notifyFunded.mockResolvedValue('0xnotify');

    await relay.forwardAndFund(ESCROW, 105n);

    expect(erc20.transfer).toHaveBeenCalledWith(ESCROW, 45n);
  });

  it('throws when the hot-wallet cannot cover the shortfall', async () => {
    escrow.snapshot.mockResolvedValue(snapshot({ balance: 0n }));
    erc20.balanceOf.mockResolvedValue(10n); // hot-wallet too low for 105

    await expect(relay.forwardAndFund(ESCROW, 105n)).rejects.toThrow(
      /Hot-wallet balance/,
    );
    expect(escrow.notifyFunded).not.toHaveBeenCalled();
  });

  it('falls back to the caller amount when no snapshot is available', async () => {
    escrow.snapshot.mockResolvedValue(null);
    erc20.balanceOf
      .mockResolvedValueOnce(0n) // escrow balance
      .mockResolvedValueOnce(1_000n); // hot-wallet balance
    erc20.transfer.mockResolvedValue('0xtransfer');
    escrow.notifyFunded.mockResolvedValue('0xnotify');

    await relay.forwardAndFund(ESCROW, 105n);

    expect(erc20.transfer).toHaveBeenCalledWith(ESCROW, 105n);
  });

  it('refuses when blockchain is not ready', async () => {
    provider.isReady = false;
    await expect(relay.forwardAndFund(ESCROW, 105n)).rejects.toThrow(
      /not ready/,
    );
  });
});
