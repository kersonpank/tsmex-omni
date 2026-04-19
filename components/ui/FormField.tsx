import React from "react";
import { cx, errorBase, hintBase, labelBase } from "./formStyles";

export interface FormFieldProps {
  label?: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function FormField({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  children,
}: FormFieldProps) {
  return (
    <div className={cx("flex flex-col", className)}>
      {label && (
        <label htmlFor={htmlFor} className={labelBase}>
          {label}
          {required && (
            <span className="text-brand-red-500 ml-0.5" aria-hidden>
              *
            </span>
          )}
        </label>
      )}
      {children}
      {error ? (
        <p className={errorBase} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className={hintBase}>{hint}</p>
      ) : null}
    </div>
  );
}

export default FormField;
