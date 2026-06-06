import React from 'react';
import './ui.css';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, id, className, error, ...props }: InputProps) {
  const inputId = id || props.name;
  return (
    <div className={className}>
      {label && (
        <label className="ui-label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <input id={inputId} className="ui-input" aria-invalid={error ? true : undefined} {...props} />
      {error && <p className="ui-field-error">{error}</p>}
    </div>
  );
}

export function Textarea({ label, id, className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  const inputId = id || props.name;
  return (
    <div className={className}>
      {label && (
        <label className="ui-label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <textarea id={inputId} className="ui-textarea" {...props} />
    </div>
  );
}

export function Select({ label, id, className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  const inputId = id || props.name;
  return (
    <div className={className}>
      {label && (
        <label className="ui-label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <select id={inputId} className="ui-select" {...props}>
        {children}
      </select>
    </div>
  );
}
