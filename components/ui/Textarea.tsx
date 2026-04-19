import React from "react";
import { cx, fieldBase, fieldError } from "./formStyles";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, error, rows = 3, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={cx(fieldBase, "resize-y", error && fieldError, className)}
        {...rest}
      />
    );
  }
);

export default Textarea;
