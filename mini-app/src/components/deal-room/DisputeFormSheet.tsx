import React, { useState } from 'react';
import { BottomSheet, Button, Textarea } from '../ui';
import './deal-room.css';

interface DisputeFormSheetProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: string, files: File[]) => void | Promise<void>;
  loading?: boolean;
}

export const DisputeFormSheet: React.FC<DisputeFormSheetProps> = ({
  open,
  onClose,
  onSubmit,
  loading,
}) => {
  const [reason, setReason] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    setFiles((prev) => [...prev, ...picked]);
    picked.forEach((f) => {
      if (f.type.startsWith('image/')) {
        const url = URL.createObjectURL(f);
        setPreviews((p) => [...p, url]);
      }
    });
    e.target.value = '';
  };

  const handleSubmit = () => {
    if (reason.trim().length < 10) return;
    void onSubmit(reason.trim(), files);
    setReason('');
    setFiles([]);
    setPreviews([]);
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Открыть спор"
      footer={
        <Button
          variant="primary"
          fullWidth
          loading={loading}
          disabled={reason.trim().length < 10}
          onClick={handleSubmit}
          style={{ marginTop: 16 }}
        >
          Отправить
        </Button>
      }
    >
      <Textarea
        label="Причина спора"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Опишите проблему подробно (мин. 10 символов)…"
        rows={4}
      />
      <label style={{ display: 'block', marginTop: 12, fontSize: 'var(--text-sm)' }}>
        Скриншоты и файлы
        <input
          type="file"
          multiple
          accept="image/*,.pdf"
          onChange={handleFiles}
          style={{ display: 'block', marginTop: 8, fontSize: 'var(--text-xs)' }}
        />
      </label>
      {/* Files are uploaded to the created dispute via
          arbitrationApi.uploadEvidence in the parent onSubmit handler. */}
      {previews.length > 0 && (
        <div className="dispute-form__files">
          {previews.map((url) => (
            <img key={url} src={url} alt="" className="dispute-form__preview" />
          ))}
        </div>
      )}
    </BottomSheet>
  );
};
