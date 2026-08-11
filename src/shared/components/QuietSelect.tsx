import {
  useEffect,
  useId,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

interface QuietSelectOption<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface QuietSelectProps<T extends string | number> {
  value: T;
  options: Array<QuietSelectOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
  density?: "regular" | "compact";
  className?: string;
}

interface SelectMenuPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: "top" | "bottom";
}

const MENU_GAP = 6;
const COMPACT_MENU_GAP = 4;
const VIEWPORT_PADDING = 8;
const DEFAULT_MENU_MAX_HEIGHT = 220;
const TYPEAHEAD_RESET_MS = 500;
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function focusAdjacentControl(trigger: HTMLElement | null, direction: -1 | 1): void {
  if (!trigger) return;
  const controls = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => (
      !element.closest("[inert]")
      && element.getAttribute("aria-hidden") !== "true"
      && element.getClientRects().length > 0
    ));
  const triggerIndex = controls.indexOf(trigger);
  const target = triggerIndex >= 0 ? controls[triggerIndex + direction] : null;
  (target ?? trigger).focus();
}

export default function QuietSelect<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  density = "regular",
  className,
}: QuietSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [menuPosition, setMenuPosition] = useState<SelectMenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const typeaheadBufferRef = useRef("");
  const typeaheadResetRef = useRef<number | null>(null);
  const listboxId = useId();

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value),
    [options, value],
  );
  const menuReady = open && menuPosition !== null;

  const closeMenu = (restoreFocus = false) => {
    setOpen(false);
    setMenuPosition(null);
    typeaheadBufferRef.current = "";
    if (typeaheadResetRef.current !== null) {
      window.clearTimeout(typeaheadResetRef.current);
      typeaheadResetRef.current = null;
    }
    if (restoreFocus) {
      requestAnimationFrame(() => {
        triggerRef.current?.focus();
      });
    }
  };

  const resolveMenuPosition = useCallback((measuredHeight?: number): SelectMenuPosition | null => {
    const trigger = triggerRef.current;
    if (!trigger) return null;

    const rect = trigger.getBoundingClientRect();
    const menuHeight = measuredHeight ?? listRef.current?.offsetHeight ?? DEFAULT_MENU_MAX_HEIGHT;
    const baseWidth = density === "compact" ? rect.width : Math.max(rect.width, 120);
    const width = Math.min(
      baseWidth,
      Math.max(window.innerWidth - VIEWPORT_PADDING * 2, 1),
    );
    const menuGap = density === "compact" ? COMPACT_MENU_GAP : MENU_GAP;
    const belowTop = rect.bottom + menuGap;
    const aboveTop = rect.top - menuHeight - menuGap;
    const spaceBelow = window.innerHeight - belowTop - VIEWPORT_PADDING;
    const spaceAbove = rect.top - menuGap - VIEWPORT_PADDING;
    const shouldFlip = spaceBelow < menuHeight && spaceAbove > spaceBelow;
    const availableSpace = Math.max(shouldFlip ? spaceAbove : spaceBelow, 96);
    const maxHeight = Math.min(DEFAULT_MENU_MAX_HEIGHT, availableSpace);
    const top = shouldFlip
      ? clamp(aboveTop, VIEWPORT_PADDING, window.innerHeight - maxHeight - VIEWPORT_PADDING)
      : clamp(belowTop, VIEWPORT_PADDING, window.innerHeight - maxHeight - VIEWPORT_PADDING);
    const left = clamp(rect.left, VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING);

    return {
      top,
      left,
      width,
      maxHeight,
      placement: shouldFlip ? "top" : "bottom",
    };
  }, [density]);

  const updateMenuPosition = useCallback((measuredHeight?: number) => {
    const nextPosition = resolveMenuPosition(measuredHeight);
    if (!nextPosition) return;
    setMenuPosition((current) => {
      if (
        current
        && Math.abs(current.top - nextPosition.top) < 1
        && Math.abs(current.left - nextPosition.left) < 1
        && Math.abs(current.width - nextPosition.width) < 1
        && Math.abs(current.maxHeight - nextPosition.maxHeight) < 1
        && current.placement === nextPosition.placement
      ) {
        return current;
      }
      return nextPosition;
    });
  }, [resolveMenuPosition]);

  const openMenu = useCallback(() => {
    setMenuPosition(density === "compact" ? null : resolveMenuPosition());
    setOpen(true);
  }, [density, resolveMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      closeMenu();
    };
    document.addEventListener("pointerdown", handleOutside);
    return () => document.removeEventListener("pointerdown", handleOutside);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    updateMenuPosition(listRef.current?.offsetHeight);
    return undefined;
  }, [open, options.length, updateMenuPosition]);

  useEffect(() => {
    if (!open) return undefined;
    const handleViewportChange = () => {
      updateMenuPosition(listRef.current?.offsetHeight);
    };
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => () => {
    if (typeaheadResetRef.current !== null) {
      window.clearTimeout(typeaheadResetRef.current);
    }
  }, []);

  useEffect(() => {
    if (disabled && open) {
      closeMenu();
    }
  }, [disabled, open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
      }
    };
    document.addEventListener("keydown", handleDocumentKeyDown);
    return () => document.removeEventListener("keydown", handleDocumentKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setHighlightedIndex(-1);
      return;
    }
    const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : options.findIndex((option) => !option.disabled));
  }, [open, options, value]);

  useLayoutEffect(() => {
    if (!menuReady) return undefined;
    listRef.current?.focus();
    return undefined;
  }, [menuReady]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openMenu();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) {
        closeMenu();
      } else {
        openMenu();
      }
      return;
    }
    if (event.key === "Escape") {
      closeMenu();
    }
  };

  const handleListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key === "Tab") {
      event.preventDefault();
      const direction = event.shiftKey ? -1 : 1;
      closeMenu();
      requestAnimationFrame(() => focusAdjacentControl(triggerRef.current, direction));
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    const enabledIndexes = options
      .map((option, index) => ({ option, index }))
      .filter((item) => !item.option.disabled)
      .map((item) => item.index);
    if (enabledIndexes.length === 0) {
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setHighlightedIndex(
        event.key === "Home" ? enabledIndexes[0] : enabledIndexes[enabledIndexes.length - 1],
      );
      return;
    }

    if (
      event.key.length === 1
      && event.key !== " "
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
    ) {
      event.preventDefault();
      const nextBuffer = `${typeaheadBufferRef.current}${event.key.toLocaleLowerCase()}`;
      const searchText = Array.from(nextBuffer).every((character) => character === nextBuffer[0])
        ? nextBuffer[0]
        : nextBuffer;
      typeaheadBufferRef.current = nextBuffer;
      if (typeaheadResetRef.current !== null) {
        window.clearTimeout(typeaheadResetRef.current);
      }
      typeaheadResetRef.current = window.setTimeout(() => {
        typeaheadBufferRef.current = "";
        typeaheadResetRef.current = null;
      }, TYPEAHEAD_RESET_MS);
      const currentPos = enabledIndexes.indexOf(highlightedIndex);
      const orderedIndexes = [
        ...enabledIndexes.slice(currentPos + 1),
        ...enabledIndexes.slice(0, currentPos + 1),
      ];
      const match = orderedIndexes.find((index) => (
        options[index]?.label.trim().toLocaleLowerCase().startsWith(searchText)
      ));
      if (match !== undefined) {
        setHighlightedIndex(match);
      }
      return;
    }

    if (
      event.key !== "ArrowDown"
      && event.key !== "ArrowUp"
      && event.key !== "Enter"
      && event.key !== " "
    ) {
      return;
    }
    event.preventDefault();
    const currentPos = enabledIndexes.indexOf(highlightedIndex);
    if (event.key === "ArrowDown") {
      const nextPos = currentPos < 0 ? 0 : (currentPos + 1) % enabledIndexes.length;
      setHighlightedIndex(enabledIndexes[nextPos]);
      return;
    }
    if (event.key === "ArrowUp") {
      const nextPos = currentPos < 0 ? enabledIndexes.length - 1 : (currentPos - 1 + enabledIndexes.length) % enabledIndexes.length;
      setHighlightedIndex(enabledIndexes[nextPos]);
      return;
    }
    const nextIndex = highlightedIndex >= 0 ? highlightedIndex : enabledIndexes[0];
    const target = options[nextIndex];
    if (target && !target.disabled) {
      onChange(target.value);
      closeMenu(true);
    }
  };

  const menuStyle: CSSProperties | undefined = menuPosition
    ? {
      top: `${menuPosition.top}px`,
      left: `${menuPosition.left}px`,
      width: `${menuPosition.width}px`,
      maxHeight: `${menuPosition.maxHeight}px`,
    }
    : { visibility: "hidden" };

  const menu = open ? (
    <ul
      ref={listRef}
      id={listboxId}
      role="listbox"
      tabIndex={-1}
      aria-labelledby={`${listboxId}-trigger`}
      aria-activedescendant={highlightedIndex >= 0 ? `${listboxId}-option-${highlightedIndex}` : undefined}
      onKeyDown={handleListKeyDown}
      className={`qp-select-menu qp-select-menu-${menuPosition?.placement ?? "bottom"} qp-select-menu-density-${density}`}
      style={menuStyle}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        const highlighted = index === highlightedIndex;
        return (
          <li key={String(option.value)} role="none">
            <button
              type="button"
              id={`${listboxId}-option-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={selected}
              aria-disabled={option.disabled || undefined}
              disabled={option.disabled}
              onMouseEnter={() => setHighlightedIndex(index)}
              onClick={() => {
                if (option.disabled) return;
                onChange(option.value);
                closeMenu(true);
              }}
              className={`qp-select-option ${selected ? "qp-select-option-selected" : ""} ${highlighted ? "qp-select-option-highlighted" : ""}`}
            >
              {option.label}
            </button>
          </li>
        );
      })}
    </ul>
  ) : null;

  return (
    <div
      ref={rootRef}
      className={`qp-select-root qp-select-root-${density} ${className ?? ""}`}
    >
      <button
        ref={triggerRef}
        type="button"
        id={`${listboxId}-trigger`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={selectedOption ? `${ariaLabel}: ${selectedOption.label}` : ariaLabel}
        disabled={disabled}
        onClick={() => {
          if (open) {
            closeMenu();
          } else {
            openMenu();
          }
        }}
        onKeyDown={handleKeyDown}
        className={`qp-control qp-select-trigger qp-select-trigger-${density}`}
      >
        <span className="qp-select-label-stack" aria-hidden="true">
          {options.map((option) => (
            <span
              key={String(option.value)}
              className={`qp-select-label ${option.value === value ? "qp-select-label-current" : ""}`}
            >
              {option.label}
            </span>
          ))}
        </span>
        <ChevronDown size={14} className={`qp-select-caret ${open ? "qp-select-caret-open" : ""}`} />
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}
