import React from 'react';
import { ScrollText } from 'lucide-react';
import { Button, Card } from '../ui';
import './deal-room.css';

interface DealCreateContractCardProps {
  loading?: boolean;
  onCreate: () => void;
}

export const DealCreateContractCard: React.FC<DealCreateContractCardProps> = ({
  loading,
  onCreate,
}) => (
  <Card className="deal-create-contract slide-up">
    <div className="deal-create-contract__header">
      <ScrollText size={18} className="deal-create-contract__icon" />
      <div>
        <p className="deal-create-contract__title">Условия согласованы</p>
        <p className="deal-create-contract__desc">
          Создайте смарт-контракт — покупатель сможет безопасно отправить средства.
        </p>
      </div>
    </div>
    <Button variant="primary" fullWidth loading={loading} onClick={onCreate}>
      Создать смарт-контракт
    </Button>
  </Card>
);
