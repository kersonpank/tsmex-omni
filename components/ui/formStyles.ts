export const fieldBase =
  "w-full rounded-lg px-3 py-2 text-sm " +
  "bg-white dark:bg-tower-800 " +
  "text-tower-900 dark:text-tower-100 " +
  "placeholder:text-tower-400 dark:placeholder:text-tower-500 " +
  "border border-tower-300 dark:border-tower-600 " +
  "focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 " +
  "disabled:bg-tower-100 dark:disabled:bg-tower-900 disabled:text-tower-400 disabled:cursor-not-allowed " +
  "transition-colors";

export const fieldError =
  "border-brand-red-500 focus:ring-brand-red-500/40 focus:border-brand-red-500";

export const labelBase =
  "block text-sm font-medium text-tower-700 dark:text-tower-200 mb-1";

export const hintBase = "text-xs text-tower-500 dark:text-tower-400 mt-1";

export const errorBase =
  "text-xs text-brand-red-600 dark:text-brand-red-400 mt-1";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
