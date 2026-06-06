import { useCallback, useState } from 'react';
import { BrowserProvider, Contract } from 'ethers';
import { ESCROW_RELEASE_ABI } from '../contracts/escrow-release-abi';
import { dealsApi } from '../api';

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

export interface EscrowReleaseState {
  connecting: boolean;
  releasing: boolean;
  walletAddress: string | null;
  error: string | null;
  txHash: string | null;
}

export function useEscrowRelease(dealId: string, chainId: number) {
  const [state, setState] = useState<EscrowReleaseState>({
    connecting: false,
    releasing: false,
    walletAddress: null,
    error: null,
    txHash: null,
  });

  const connectWallet = useCallback(async () => {
    if (!window.ethereum) {
      setState((s) => ({
        ...s,
        error: 'Установите MetaMask или другой Web3-кошелёк',
      }));
      return null;
    }
    setState((s) => ({ ...s, connecting: true, error: null }));
    try {
      const chainHex = `0x${chainId.toString(16)}`;
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainHex }],
        });
      } catch {
        /* user may reject switch — still try connect */
      }
      const accounts = (await window.ethereum.request({
        method: 'eth_requestAccounts',
      })) as string[];
      const addr = accounts[0] ?? null;
      setState((s) => ({ ...s, connecting: false, walletAddress: addr }));
      return addr;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось подключить кошелёк';
      setState((s) => ({ ...s, connecting: false, error: msg }));
      return null;
    }
  }, [chainId]);

  const releaseFunds = useCallback(
    async (escrowAddress: string, expectedBuyerWallet?: string | null) => {
      if (!window.ethereum) {
        setState((s) => ({ ...s, error: 'Web3-кошелёк не найден' }));
        return;
      }
      setState((s) => ({ ...s, releasing: true, error: null }));
      try {
        const provider = new BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const signerAddr = await signer.getAddress();
        if (
          expectedBuyerWallet &&
          signerAddr.toLowerCase() !== expectedBuyerWallet.toLowerCase()
        ) {
          throw new Error(
            'Подключите кошелёк покупателя, привязанный к сделке',
          );
        }
        const contract = new Contract(escrowAddress, ESCROW_RELEASE_ABI, signer);
        const tx = await contract.release();
        setState((s) => ({ ...s, txHash: tx.hash as string }));
        await tx.wait();
        await dealsApi.syncEscrowRelease(dealId, tx.hash as string);
        setState((s) => ({ ...s, releasing: false }));
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Ошибка транзакции release()';
        setState((s) => ({ ...s, releasing: false, error: msg }));
      }
    },
    [dealId],
  );

  return { ...state, connectWallet, releaseFunds };
}
