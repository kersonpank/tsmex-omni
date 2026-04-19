import React from "react";
import { cx } from "./formStyles";

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: React.ReactNode;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ className, label, id, disabled, ...rest }, ref) {
    const input = (
      <input
        ref={ref}
        id={id}
        type="checkbox"
        disabled={disabled}
        className={cx(
          "h-4 w-4 rounded border-tower-300 dark:border-tower-500 text-brand-600 " +
            "bg-white dark:bg-tower-800 " +
            "focus:ring-2 focus:ring-brand-500/40 focus:ring-offset-0 " +
            "disabled:opacity-50 disabled:cursor-not-allowed accent-brand-600",
          className
        )}
        {...rest}
      />
    );
    if (!label) return input;
    return (
      <label
        htmlFor={id}
        className={cx(
          "inline-flex items-center gap-2 text-sm text-tower-700 dark:text-tower-200",
          disabled && "opacity-60 cursor-not-allowed"
        )}
      >
        {input}
        <span>{label}</span>
      </label>
    );
  }
);

export default Checkbox;
