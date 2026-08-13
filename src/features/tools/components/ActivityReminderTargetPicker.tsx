import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import QuietSearchField from "../../../shared/components/QuietSearchField.tsx";
import type {
  ActivityReminderAppCandidate,
  ActivityReminderCategoryCandidate,
  ActivityReminderWebCandidate,
} from "../../../shared/types/tools.ts";
import {
  buildActivityReminderTargetOptions,
  filterActivityReminderTargetOptions,
  findActivityReminderTargetOption,
  type ActivityReminderTargetMode,
  type ActivityReminderTargetOption,
} from "../services/activityReminderTargetOptions.ts";

interface ActivityReminderTargetPickerProps {
  mode: ActivityReminderTargetMode;
  value: string;
  appCandidates: readonly ActivityReminderAppCandidate[];
  categoryCandidates: readonly ActivityReminderCategoryCandidate[];
  webCandidates: readonly ActivityReminderWebCandidate[];
  icons: Record<string, string>;
  placeholder: string;
  ariaLabel: string;
  onChange: (value: string) => void;
}

const candidateListMaxHeight = 46 * 4 + 6 * 3 + 12;

function optionInitial(label: string) {
  return label.trim().slice(0, 1).toUpperCase() || "?";
}

export default function ActivityReminderTargetPicker({
  mode,
  value,
  appCandidates,
  categoryCandidates,
  webCandidates,
  icons,
  placeholder,
  ariaLabel,
  onChange,
}: ActivityReminderTargetPickerProps) {
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = `activity-reminder-target-${useId()}`;
  const [searchFocused, setSearchFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [candidateListStyle, setCandidateListStyle] = useState<CSSProperties | null>(null);
  const options = useMemo(
    () => buildActivityReminderTargetOptions(
      mode,
      appCandidates,
      categoryCandidates,
      webCandidates,
      icons,
    ),
    [appCandidates, categoryCandidates, icons, mode, webCandidates],
  );
  const selectedOption = useMemo(
    () => findActivityReminderTargetOption(value, options),
    [options, value],
  );
  const displayValue = selectedOption?.label ?? value;
  const visibleOptions = useMemo(
    () => filterActivityReminderTargetOptions(displayValue, options),
    [displayValue, options],
  );
  const listOpen = searchFocused && visibleOptions.length > 0 && candidateListStyle !== null;

  const updateCandidateListPosition = useCallback(() => {
    const field = fieldRef.current;
    if (!field) return;

    const rect = field.getBoundingClientRect();
    const viewportMargin = 12;
    const gap = 6;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(rect.width, Math.max(0, viewportWidth - viewportMargin * 2));
    const left = Math.min(
      Math.max(rect.left, viewportMargin),
      Math.max(viewportMargin, viewportWidth - viewportMargin - width),
    );
    const belowTop = rect.bottom + gap;
    const belowHeight = Math.max(0, viewportHeight - viewportMargin - belowTop);
    const aboveHeight = Math.max(0, rect.top - viewportMargin - gap);
    const openAbove = belowHeight < 180 && aboveHeight > belowHeight;
    const viewportListHeight = Math.max(80, viewportHeight - viewportMargin * 2);
    const availableHeight = openAbove ? aboveHeight : belowHeight;
    const maxHeight = Math.min(
      viewportListHeight,
      candidateListMaxHeight,
      Math.max(120, availableHeight),
    );
    const top = openAbove
      ? Math.max(viewportMargin, rect.top - gap - maxHeight)
      : Math.min(belowTop, viewportHeight - viewportMargin - maxHeight);

    setCandidateListStyle({ left, top, width, maxHeight });
  }, []);

  useLayoutEffect(() => {
    if (!searchFocused || visibleOptions.length === 0) {
      setCandidateListStyle(null);
      return undefined;
    }

    updateCandidateListPosition();
    window.addEventListener("resize", updateCandidateListPosition);
    window.addEventListener("scroll", updateCandidateListPosition, true);
    return () => {
      window.removeEventListener("resize", updateCandidateListPosition);
      window.removeEventListener("scroll", updateCandidateListPosition, true);
    };
  }, [searchFocused, updateCandidateListPosition, visibleOptions.length]);

  useLayoutEffect(() => {
    if (!listOpen || activeIndex < 0) return;
    document.getElementById(`${listId}-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listId, listOpen]);

  const selectOption = (option: ActivityReminderTargetOption) => {
    onChange(option.value);
    setSearchFocused(false);
    setActiveIndex(-1);
    inputRef.current?.blur();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setSearchFocused(false);
      setActiveIndex(-1);
      inputRef.current?.blur();
      return;
    }
    if (visibleOptions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSearchFocused(true);
      setActiveIndex((current) => Math.min(current + 1, visibleOptions.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSearchFocused(true);
      setActiveIndex((current) => (current <= 0 ? visibleOptions.length - 1 : current - 1));
      return;
    }
    if (event.key === "Enter" && listOpen && activeIndex >= 0) {
      event.preventDefault();
      const option = visibleOptions[activeIndex];
      if (option) selectOption(option);
    }
  };

  return (
    <div ref={fieldRef} className="tools-activity-target-search-field">
      <QuietSearchField
        ref={inputRef}
        className="tools-activity-target-search"
        value={displayValue}
        onFocus={() => {
          setSearchFocused(true);
          setActiveIndex(-1);
        }}
        onBlur={() => {
          setSearchFocused(false);
          setActiveIndex(-1);
        }}
        onChange={(event) => {
          onChange(event.target.value);
          setSearchFocused(true);
          setActiveIndex(-1);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={listOpen}
        aria-controls={listOpen ? listId : undefined}
        aria-activedescendant={listOpen && activeIndex >= 0
          ? `${listId}-option-${activeIndex}`
          : undefined}
      />
      {listOpen ? (
        <div
          id={listId}
          className="tools-activity-target-candidate-list data-app-list qp-scroll-region qp-scroll-region-stable"
          style={candidateListStyle}
          role="listbox"
          aria-label={ariaLabel}
        >
          {visibleOptions.map((option, index) => {
            const isSelected = option.key === selectedOption?.key;
            const isActive = index === activeIndex;
            return (
              <button
                id={`${listId}-option-${index}`}
                key={option.key}
                type="button"
                role="option"
                aria-selected={isSelected}
                tabIndex={-1}
                className={`data-app-option ${isActive ? "tools-activity-target-option-active" : ""}`.trim()}
                onMouseMove={() => {
                  if (activeIndex >= 0) setActiveIndex(-1);
                }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectOption(option)}
              >
                <span
                  className="data-app-option-icon"
                  data-activity-category-marker={option.accentColor ? "" : undefined}
                  aria-hidden
                  style={option.accentColor ? { "--activity-category-color": option.accentColor } as CSSProperties : undefined}
                >
                  {option.accentColor ? (
                    <span className="tools-activity-category-dot" />
                  ) : option.iconUrl ? (
                    <img src={option.iconUrl} alt="" draggable={false} />
                  ) : optionInitial(option.label)}
                </span>
                <span className="data-app-option-main">
                  <span className="data-app-option-name">{option.label}</span>
                  {option.meta ? <span className="data-app-option-meta">{option.meta}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
