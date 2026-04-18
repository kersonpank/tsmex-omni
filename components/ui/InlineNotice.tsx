import React from 'react';

export type NoticeVariant = 'error' | 'success' | 'info';

const variants: Record<NoticeVariant, string> = {
  error: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/50 dark:text-red-100',
  success:
    'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100',
  info: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/40 dark:bg-sky-950/40 dark:text-sky-100',
};

interface InlineNoticeProps {
  variant: NoticeVariant;
  message: string;
  onDismiss?: () => void;
}

const InlineNotice: React.FC<InlineNoticeProps> = ({ variant, message, onDismiss }) => (
  <div
    role={variant === 'error' ? 'alert' : 'status'}
    className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-medium ${variants[variant]}`}
  >
    <span className="min-w-0 flex-1">{message}</span>
    {onDismiss && (
      <button
        type="button"
        onClick={onDismiss}
        className="admin-focus shrink-0 rounded-lg px-2 py-0.5 text-xs underline-offset-2 hover:underline"
      >
        Fechar
      </button>
    )}
  </div>
);

export default InlineNotice;
