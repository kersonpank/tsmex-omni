import React from 'react';
import clsx from 'clsx';

type TToggleColor = 'blue' | 'amber' | 'red' | 'green' | 'teal' | 'purple' | 'pink' | 'gray';

const trackOn: Record<TToggleColor, string> = {
  blue: 'bg-brand-600 border-brand-500',
  amber: 'bg-amber-500 border-amber-400',
  red: 'bg-brand-red-500 border-brand-red-400',
  green: 'bg-green-600 border-green-500',
  teal: 'bg-teal-600 border-teal-500',
  purple: 'bg-purple-600 border-purple-500',
  pink: 'bg-pink-600 border-pink-500',
  gray: 'bg-tower-600 border-tower-500',
};

const trackOff = 'bg-tower-200 border-tower-300 dark:bg-tower-700 dark:border-tower-600';

export interface ToggleProps {
  checked: boolean;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  size?: 'small' | 'large';
  color?: TToggleColor;
  icon?: {
    checked: React.ReactNode;
    unchecked: React.ReactNode;
  };
  direction?: 'switch-first' | 'label-first';
  children?: React.ReactNode;
  className?: string;
}

export const Toggle = ({
  checked,
  onChange,
  disabled = false,
  size = 'small',
  color = 'blue',
  icon,
  direction = 'label-first',
  children,
  className,
  ...rest
}: ToggleProps) => {
  const h = size === 'small' ? 'h-4 min-w-[2rem]' : 'h-6 min-w-[2.75rem]';
  const knob = size === 'small' ? 'h-3 w-3' : 'h-[22px] w-[22px]';

  return (
    <label
      className={clsx(
        'inline-flex items-center gap-2 text-xs text-tower-600 dark:text-tower-300 select-none',
        direction === 'switch-first' && 'flex-row-reverse',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
      {...rest}
    >
      {children != null && children !== '' && <span>{children}</span>}
      <input
        className="sr-only"
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      <span
        className={clsx(
          'inline-flex cursor-pointer items-center rounded-full border p-0.5 transition-colors duration-200',
          h,
          checked ? trackOn[color] : trackOff,
          checked ? 'justify-end' : 'justify-start',
        )}
        aria-hidden
      >
        <span
          className={clsx(
            'inline-flex rounded-full bg-white shadow',
            knob,
            'items-center justify-center',
          )}
        >
          {icon && checked && icon.checked}
          {icon && !checked && icon.unchecked}
        </span>
      </span>
    </label>
  );
};
