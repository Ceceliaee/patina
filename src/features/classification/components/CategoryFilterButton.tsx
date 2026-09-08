import { useEffect, useId, useRef, useState } from "react";
import { Check, Filter, RotateCcw } from "lucide-react";
import QuietIconAction from "../../../shared/components/QuietIconAction.tsx";
import QuietAnchoredPopover from "../../../shared/components/QuietAnchoredPopover.tsx";
import QuietSearchField from "../../../shared/components/QuietSearchField.tsx";
import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import type { UserAssignableAppCategory } from "../../../shared/classification/categoryTokens.ts";

interface CategoryFilterOption {
  value: UserAssignableAppCategory;
  label: string;
  color: string;
}

interface Props {
  value: UserAssignableAppCategory | null;
  options: CategoryFilterOption[];
  onChange: (value: UserAssignableAppCategory | null) => void;
  disabled: boolean;
}

export default function CategoryFilterButton({ value, options, onChange, disabled }: Props) {
  const text = useLocaleText();
  const copy = text.mapping;
  const locale = useLocale();
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeValue, setActiveValue] = useState<UserAssignableAppCategory | null>(value);
  const selected = options.find((option) => option.value === value);
  const label = selected ? `${copy.categoryFilter} · ${selected.label}` : copy.categoryFilter;
  const visible = options.filter((option) => option.label.toLocaleLowerCase(locale)
    .includes(query.trim().toLocaleLowerCase(locale)));
  const activeIndex = Math.max(0, visible.findIndex((option) => option.value === activeValue));
  const expanded = open && !disabled;
  const close = () => {
    setOpen(false);
    buttonRef.current?.focus({ preventScroll: true });
  };
  const select = (next: UserAssignableAppCategory | null) => {
    onChange(next);
    close();
  };

  useEffect(() => {
    if (!expanded) return;
    const option = document.getElementById(`${id}-option-${activeIndex}`);
    const list = option?.parentElement;
    if (!option || !list) return;
    const itemRect = option.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    if (itemRect.top < listRect.top) list.scrollTop -= listRect.top - itemRect.top;
    else if (itemRect.bottom > listRect.bottom) list.scrollTop += itemRect.bottom - listRect.bottom;
  }, [activeIndex, expanded, id]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <>
      <span className="inline-flex items-center gap-1">
        {value !== null && (
          <QuietIconAction
            icon={<RotateCcw size={14} aria-hidden />}
            title={copy.categoryFilterReset}
            disabled={disabled}
            className="qp-category-filter-reset"
            onClick={() => select(null)}
          />
        )}
        <QuietIconAction
          icon={<Filter size={14} aria-hidden />}
          title={label}
          showTooltip={false}
          buttonRef={buttonRef}
          pressed={value !== null}
          showPressedStyle={false}
          disabled={disabled}
          expanded={expanded}
          controls={expanded ? id : undefined}
          className="qp-category-filter-trigger"
          onClick={() => {
            if (expanded) close();
            else {
              setQuery("");
              setActiveValue(value);
              setOpen(true);
            }
          }}
        />
      </span>
      <QuietAnchoredPopover
        id={id}
        open={expanded}
        anchor={buttonRef.current}
        ariaLabel={copy.categoryFilter}
        onClose={close}
        className="qp-category-filter-popover"
        initialFocusRef={searchRef}
        horizontalAnchorRatio={0}
      >
        <QuietSearchField
          ref={searchRef}
          value={query}
          placeholder={text.data.categorySearchPlaceholder}
          aria-label={text.data.categorySearchPlaceholder}
          role="combobox"
          aria-expanded={expanded}
          aria-autocomplete="list"
          aria-controls={`${id}-list`}
          aria-activedescendant={visible.length ? `${id}-option-${activeIndex}` : undefined}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveValue(null);
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Tab") {
              close();
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!visible.length) return;
              const direction = event.key === "ArrowDown" ? 1 : -1;
              setActiveValue(visible[(activeIndex + direction + visible.length) % visible.length].value);
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (visible.length) select(visible[activeIndex].value);
            }
          }}
        />
        <div id={`${id}-list`} role="listbox" aria-label={copy.categoryFilter}
          className="qp-category-filter-list qp-scroll-region">
          {visible.map((option, index) => (
            <button
              key={option.value}
              id={`${id}-option-${index}`}
              type="button"
              role="option"
              aria-selected={option.value === value}
              tabIndex={-1}
              className={`qp-category-filter-option ${index === activeIndex ? "qp-category-filter-option-active" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => select(option.value)}
            >
              <span className="qp-category-filter-dot" aria-hidden
                style={{ backgroundColor: option.color || undefined }} />
              <span className="qp-category-filter-label">{option.label}</span>
              {option.value === value && <Check size={14} aria-hidden />}
            </button>
          ))}
        </div>
        {visible.length === 0 && <p className="qp-category-filter-empty" role="status">{text.data.categoryTrendNoMatch}</p>}
      </QuietAnchoredPopover>
    </>
  );
}
