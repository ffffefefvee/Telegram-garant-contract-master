export const TON_JETTON_WALLET_CONTRACT_PROFILES = [
  "tep74-reference-wallet-v1",
  "tep74-library-wallet-v1",
  "ton-stablecoin-governance-wallet-v1",
] as const;

export type TonJettonWalletContractProfile =
  (typeof TON_JETTON_WALLET_CONTRACT_PROFILES)[number];

export function isTonJettonWalletContractProfile(
  value: unknown,
): value is TonJettonWalletContractProfile {
  return (
    typeof value === "string" &&
    (TON_JETTON_WALLET_CONTRACT_PROFILES as readonly string[]).includes(value)
  );
}
