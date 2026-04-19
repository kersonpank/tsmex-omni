import React from "react";
import { cx, fieldBase, fieldError } from "./formStyles";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input({ className, error, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={cx(fieldBase, error && fieldError, className)}
        {...rest}
      />
    );
  }
);

export default Input;
