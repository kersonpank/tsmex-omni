import React from "react";
import { cx, fieldBase, fieldError } from "./formStyles";

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ className, error, children, ...rest }, ref) {
    return (
      <select
        ref={ref}
        className={cx(fieldBase, "pr-8", error && fieldError, className)}
        {...rest}
      >
        {children}
      </select>
    );
  }
);

export default Select;
