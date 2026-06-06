import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { storeApi } from '../api';
import { PageHeader, Button, Input, Textarea, Card } from '../components/ui';
import './BotEditPage.css';

const CURRENCIES = ['RUB', 'USDT', 'BTC', 'ETH'] as const;

export const BotEditPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [welcome, setWelcome] = useState('');
  const [rules, setRules] = useState('');
  const [currencies, setCurrencies] = useState<string[]>(['RUB', 'USDT']);
  const [loading, setLoading] = useState(!isNew);

  useEffect(() => {
    if (isNew || !id) return;
    storeApi.getBot(id).then((bot) => {
      if (bot) {
        setName(bot.name);
        setDescription(bot.description);
        setWelcome(bot.welcomeMessage);
        setRules(bot.rulesText);
        setCurrencies(bot.currencies);
      }
      setLoading(false);
    });
  }, [id, isNew]);

  const toggleCurrency = (c: string) => {
    setCurrencies((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  };

  const handlePayPlacement = () => {
    navigate('/deal/new');
  };

  if (loading) {
    return (
      <div className="bot-edit-page page-scroll">
        <PageHeader title="Загрузка…" onBack={() => navigate('/bots')} />
      </div>
    );
  }

  return (
    <div className="bot-edit-page page-scroll">
      <PageHeader
        title={isNew ? 'Новый бот' : 'Редактирование'}
        onBack={() => navigate('/bots')}
      />

      <div className="bot-edit-form slide-up">
        <Input label="Название" value={name} onChange={(e) => setName(e.target.value)} />
        <Textarea
          label="Описание"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />
        <fieldset className="bot-edit-currencies">
          <legend>Валюты</legend>
          {CURRENCIES.map((c) => (
            <label key={c} className="bot-edit-check">
              <input
                type="checkbox"
                checked={currencies.includes(c)}
                onChange={() => toggleCurrency(c)}
              />
              {c}
            </label>
          ))}
        </fieldset>
        <Textarea
          label="Приветственное сообщение"
          value={welcome}
          onChange={(e) => setWelcome(e.target.value)}
          rows={2}
        />
        <Textarea
          label="Текст правил"
          value={rules}
          onChange={(e) => setRules(e.target.value)}
          rows={3}
        />
        <Card className="bot-edit-pay-card">
          <p>Размещение бота требует оплаты через отдельный смарт-контракт платформы.</p>
          <Button variant="primary" fullWidth onClick={handlePayPlacement}>
            Оплатить размещение
          </Button>
        </Card>
        <Button variant="secondary" fullWidth onClick={() => navigate('/bots')}>
          Сохранить (демо)
        </Button>
      </div>
    </div>
  );
};
