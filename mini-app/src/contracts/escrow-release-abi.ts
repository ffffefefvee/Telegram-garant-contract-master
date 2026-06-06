/** Minimal ABI for buyer-signed EscrowImplementation.release(). */
export const ESCROW_RELEASE_ABI = [
  'function release() external',
  'function status() external view returns (uint8)',
] as const;
