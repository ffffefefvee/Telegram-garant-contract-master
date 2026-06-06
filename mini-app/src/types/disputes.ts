export type DisputeListStatus = 'in_review' | 'resolved';

export interface DisputeListItem {
  id: string;
  dealId: string;
  dealNumber: string;
  amount: number;
  currency: string;
  status: DisputeListStatus;
  openedAt: string;
  counterpartyName: string;
}

export interface DisputeTimelineEvent {
  id: string;
  at: string;
  title: string;
  description?: string;
}

export interface DisputeEvidence {
  id: string;
  url: string;
  name: string;
  uploadedBy: 'buyer' | 'seller';
}

export interface DisputeDetail {
  id: string;
  dealId: string;
  dealNumber: string;
  amount: number;
  currency: string;
  usdtAmount: number;
  status: DisputeListStatus;
  reason: string;
  timeline: DisputeTimelineEvent[];
  evidence: DisputeEvidence[];
  decision?: {
    winner: 'buyer' | 'seller';
    comment: string;
    decidedAt: string;
  };
}
