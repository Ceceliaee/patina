import { useEffect, useId, useRef, useState } from "react";
import { Filter } from "lucide-react";
import QuietIconAction from "../../../shared/components/QuietIconAction.tsx";
import QuietAnchoredPopover from "../../../shared/components/QuietAnchoredPopover.tsx";
import QuietSearchField from "../../../shared/components/QuietSearchField.tsx";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import type { UserAssignableAppCategory } from "../../../shared/classification/categoryTokens.ts";

interface Props {
  value: string;
  options: Array<{ value: UserAssignableAppCategory; label: string; color: string }>;
  onChange: (value: string) => void;
  placeholder: string;
  disabled: boolean;
}

export default function CategorySearchField({ value, options, onChange, placeholder, disabled }: Props) {
  const text = useLocaleText();
  const id = useId();
  const anchorRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const index = Math.min(activeIndex, Math.max(0, options.length - 1));
  const expanded = open && !disabled;
  const close = () => {
    setOpen(false);
    buttonRef.current?.focus({ preventScroll: true });
  };
  const select = (label: string) => {
    onChange(label);
    setOpen(false);
    inputRef.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!expanded) return;
    const option = document.getElementById(`${id}-option-${index}`);
    const list = listRef.current;
    if (!option || !list) return;
    const itemRect = option.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    if (itemRect.top < listRect.top) list.scrollTop -= listRect.top - itemRect.top;
    else if (itemRect.bottom > listRect.bottom) list.scrollTop += itemRect.bottom - listRect.bottom;
  }, [index, expanded, id]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div ref={anchorRef} className="qp-category-search">
      <QuietSearchField
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        disabled={disabled}
      />
      <QuietIconAction
        icon={<Filter size={14} aria-hidden />}
        title={text.mapping.categoryFilter}
        showTooltip={false}
        buttonRef={buttonRef}
        disabled={disabled}
        expanded={expanded}
        controls={expanded ? id : undefined}
        className="qp-category-filter-trigger"
        onClick={() => {
          if (expanded) close();
          else {
            setActiveIndex(Math.max(0, options.findIndex((option) => option.label === value)));
            setOpen(true);
          }
        }}
      />
      <QuietAnchoredPopover
        id={id}
        open={expanded}
        anchor={anchorRef.current}
        ariaLabel={text.mapping.categoryFilter}
        onClose={close}
        className="qp-category-filter-popover"
        initialFocusRef={listRef}
      >
        <div ref={listRef} role="listbox" tabIndex={0} aria-label={text.mapping.categoryFilter}
          aria-activedescendant={options.length ? `${id}-option-${index}` : undefined}
          className="qp-category-filter-list qp-scroll-region"
          onBlur={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "Tab") close();
            else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (options.length) setActiveIndex((index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
            } else if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              if (options.length) select(options[index].label);
            }
          }}>
          {options.map((option, optionIndex) => (
            <button key={option.value} id={`${id}-option-${optionIndex}`} type="button" role="option"
              aria-selected={option.label === value} tabIndex={-1}
              className={`qp-category-filter-option ${optionIndex === index ? "qp-category-filter-option-active" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => select(option.label)}>
              <span className="qp-category-filter-dot" aria-hidden style={{ backgroundColor: option.color }} />
              <span className="qp-category-filter-label">{option.label}</span>
            </button>
          ))}
        </div>
        {!options.length && <p className="qp-category-filter-empty" role="status">{text.data.categoryTrendNoMatch}</p>}
      </QuietAnchoredPopover>
    </div>
  );
}
