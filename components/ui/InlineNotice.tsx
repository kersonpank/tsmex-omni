import React from 'react';

export type NoticeVariant = 'error' | 'success' | 'info';

const variants: Record<NoticeVariant, string> = {
  error:
    'border-brand-red-500/35 bg-red-50 text-brand-red-700 dark:border-brand-red-500/30 dark:bg-brand-red-700/25 dark:text-red-50',
  success:
    'border-brand-200 bg-brand-50 text-brand-900 dark:border-brand-600 dark:bg-brand-900/75 dark:text-brand-100',
  info: 'border-brand-300 bg-brand-50 text-brand-900 dark:border-brand-600/60 dark:bg-brand-950/80 dark:text-brand-100',
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
