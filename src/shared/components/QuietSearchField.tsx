import { Search } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

type QuietSearchFieldProps = Omit<ComponentPropsWithoutRef<"input">, "className" | "type"> & {
  className?: string;
  inputClassName?: string;
};

const QuietSearchField = forwardRef<HTMLInputElement, QuietSearchFieldProps>(function QuietSearchField({
  className,
  inputClassName,
  ...inputProps
}, ref) {
  return (
    <label className={`data-app-search qp-search-field ${className ?? ""}`.trim()}>
      <Search size={14} aria-hidden />
      <input
        {...inputProps}
        ref={ref}
        type="text"
        className={inputClassName}
      />
    </label>
  );
});

export default QuietSearchField;
