import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, } from "react";
import { Check } from "lucide-react";
import { createPortal } from "react-dom";
import QuietButton from "../../../shared/components/QuietButton.tsx";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import { ProcessMapper } from "../../../shared/classification/processMapper.ts";
import type { AppOverride } from "../../../shared/classification/processMapper.ts";

import type { QuickAppClassificationOpenRequest } from "../types.ts";
import { ClassificationService } from "../services/classificationService.ts";
import {
  buildQuickAppCategoryOptions,
  buildQuickAppOverride,
  type QuickAppCategoryOption,
} from "../services/quickAppClassification.ts";

interface Props {
  request: QuickAppClassificationOpenRequest;
  onClose: (focusTarget?: HTMLElement) => void;
  onSaved: (override: AppOverride | null) => void;
  onError: (message: string) => void;
}

const MENU_MARGIN = 12;
const SUBMENU_GAP = 2;

function focusMenuItem(container: HTMLElement | null, index: number) {
  const items = container?.querySelectorAll<HTMLElement>("[role^='menuitem']:not([disabled])");
  if (!items?.length) return;
  items[(index + items.length) % items.length]?.focus();
}

function resolveAdjacentPageFocusTarget(trigger: HTMLElement, backwards: boolean) {
  const focusable = Array.from(document.querySelectorAll<HTMLElement>([
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
  ].join(","))).filter((element) => (
    !element.closest(".quick-app-menu")
    && !element.closest(".qp-dialog-backdrop")
    && element.getClientRects().length > 0
  ));
  const triggerIndex = focusable.indexOf(trigger);
  if (triggerIndex < 0) return trigger;
  return focusable[triggerIndex + (backwards ? -1 : 1)] ?? trigger;
}

export default function QuickAppClassificationSurface({
  request,
  onClose,
  onSaved,
  onError,
}: Props) {
  const UI_TEXT = useLocaleText();
  const locale = useLocale();
  const { anchor, returnFocusTo, target } = request;
  const menuRef = useRef<HTMLDivElement>(null);
  const categoryTriggerRef = useRef<HTMLButtonElement>(null);
  const categoryMenuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const [position, setPosition] = useState({ left: anchor.clientX, top: anchor.clientY });
  const [categoryPosition, setCategoryPosition] = useState({ left: anchor.clientX, top: anchor.clientY });
  const [categoryOptions, setCategoryOptions] = useState<QuickAppCategoryOption[]>([]);
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(
    ProcessMapper.getUserOverride(target.exeName)?.displayName ?? target.displayName,
  );
  const [loading, setLoading] = useState(true);
  const [categoryLoadFailed, setCategoryLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const currentCategory = target.category;

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const bounds = menu.getBoundingClientRect();
    setPosition({
      left: Math.max(MENU_MARGIN, Math.min(anchor.clientX, window.innerWidth - bounds.width - MENU_MARGIN)),
      top: Math.max(MENU_MARGIN, Math.min(anchor.clientY, window.innerHeight - bounds.height - MENU_MARGIN)),
    });
  }, [anchor.clientX, anchor.clientY]);

  useEffect(() => {
    let active = true;
    void ClassificationService.loadClassificationBootstrap().then((bootstrap) => {
      if (!active) return;
      setCategoryOptions(buildQuickAppCategoryOptions(bootstrap, UI_TEXT, locale));
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setLoading(false);
      setCategoryLoadFailed(true);
      onErrorRef.current(UI_TEXT.mapping.loadFailed);
    });
    return () => {
      active = false;
    };
  }, [UI_TEXT, locale]);

  useEffect(() => {
    if (renameOpen) return;
    const frame = window.requestAnimationFrame(() => focusMenuItem(menuRef.current, 0));
    const closeFromViewportChange = () => onClose();
    const closeFromExternalScroll = (event: Event) => {
      const scrollTarget = event.target;
      if (
        scrollTarget instanceof Node
        && (menuRef.current?.contains(scrollTarget) || categoryMenuRef.current?.contains(scrollTarget))
      ) {
        return;
      }
      onClose();
    };
    const closeFromOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", closeFromOutside, true);
    window.addEventListener("resize", closeFromViewportChange);
    window.addEventListener("scroll", closeFromExternalScroll, true);
    window.addEventListener("blur", closeFromViewportChange);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", closeFromOutside, true);
      window.removeEventListener("resize", closeFromViewportChange);
      window.removeEventListener("scroll", closeFromExternalScroll, true);
      window.removeEventListener("blur", closeFromViewportChange);
    };
  }, [onClose, renameOpen]);

  useEffect(() => {
    if (!categoryMenuOpen) return;
    const frame = window.requestAnimationFrame(() => {
      const selectedIndex = categoryOptions.findIndex((option) => option.value === currentCategory);
      focusMenuItem(categoryMenuRef.current, selectedIndex >= 0 ? selectedIndex : 0);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [categoryMenuOpen, categoryOptions, currentCategory]);

  useEffect(() => {
    if (!renameOpen) return;
    const frame = window.requestAnimationFrame(() => renameInputRef.current?.select());
    return () => window.cancelAnimationFrame(frame);
  }, [renameOpen]);

  useLayoutEffect(() => {
    const rootMenu = menuRef.current;
    const categoryMenu = categoryMenuRef.current;
    if (!categoryMenuOpen || !rootMenu || !categoryMenu) return;
    const rootBounds = rootMenu.getBoundingClientRect();
    const categoryBounds = categoryMenu.getBoundingClientRect();
    const opensLeft = rootBounds.right + SUBMENU_GAP + categoryBounds.width + MENU_MARGIN > window.innerWidth;
    setCategoryPosition({
      left: opensLeft
        ? Math.max(MENU_MARGIN, rootBounds.left - SUBMENU_GAP - categoryBounds.width)
        : Math.min(window.innerWidth - categoryBounds.width - MENU_MARGIN, rootBounds.right + SUBMENU_GAP),
      top: Math.max(
        MENU_MARGIN,
        Math.min(rootBounds.top, window.innerHeight - categoryBounds.height - MENU_MARGIN),
      ),
    });
  }, [categoryMenuOpen, categoryOptions, position]);

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      event.preventDefault();
      onClose(returnFocusTo
        ? resolveAdjacentPageFocusTarget(returnFocusTo, event.shiftKey)
        : undefined);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (categoryMenuOpen) {
        setCategoryMenuOpen(false);
        categoryTriggerRef.current?.focus();
      } else {
        onClose();
      }
      return;
    }
    if (event.key === "ArrowLeft" && categoryMenuOpen) {
      event.preventDefault();
      setCategoryMenuOpen(false);
      categoryTriggerRef.current?.focus();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const container = categoryMenuOpen && categoryMenuRef.current?.contains(document.activeElement)
        ? categoryMenuRef.current
        : menuRef.current;
      const items = Array.from(container?.querySelectorAll<HTMLElement>("[role^='menuitem']:not([disabled])") ?? []);
      const currentIndex = items.indexOf(document.activeElement as HTMLElement);
      focusMenuItem(container, currentIndex + (event.key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const container = categoryMenuOpen && categoryMenuRef.current?.contains(document.activeElement)
        ? categoryMenuRef.current
        : menuRef.current;
      const itemCount = container?.querySelectorAll("[role^='menuitem']:not([disabled])").length ?? 0;
      focusMenuItem(container, event.key === "Home" ? 0 : itemCount - 1);
    }
  };

  const saveOverride = async (override: ReturnType<typeof buildQuickAppOverride>) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await ClassificationService.saveAppOverride(target.exeName, override);
      onSaved(override);
      onClose();
    } catch {
      savingRef.current = false;
      setSaving(false);
      onErrorRef.current(UI_TEXT.mapping.quickSaveFailed);
    }
  };

  const saveCategory = (option: QuickAppCategoryOption) => {
    const current = ProcessMapper.getUserOverride(target.exeName);
    void saveOverride(buildQuickAppOverride(current, { category: option.value }));
  };

  const submitRename = (event: FormEvent) => {
    event.preventDefault();
    if (savingRef.current || !renameHasChanges) return;
    const current = ProcessMapper.getUserOverride(target.exeName);
    void saveOverride(buildQuickAppOverride(current, { displayName: renameValue }));
  };

  const currentDisplayName = ProcessMapper.getUserOverride(target.exeName)?.displayName?.trim() ?? "";
  const hasValidCategory = currentCategory !== "other";
  const normalizedRenameValue = renameValue.trim();
  const renameHasChanges = currentDisplayName
    ? normalizedRenameValue !== currentDisplayName
    : normalizedRenameValue !== target.displayName.trim() && normalizedRenameValue !== "";

  const menu = (
    <>
      {!renameOpen ? (
        <div
          ref={menuRef}
          className="quick-app-menu qp-motion-overlay-enter"
          role="menu"
          aria-label={UI_TEXT.mapping.quickMenuLabel(target.displayName)}
          style={{ left: position.left, top: position.top }}
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={handleMenuKeyDown}
        >
          <button
            type="button"
            className="quick-app-menu-item"
            role="menuitem"
            onClick={() => setRenameOpen(true)}
          >
            <span>{UI_TEXT.mapping.quickRename}</span>
          </button>
          <button
            ref={categoryTriggerRef}
            type="button"
            className="quick-app-menu-item"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={categoryMenuOpen}
            disabled={categoryLoadFailed || saving}
            onClick={() => setCategoryMenuOpen((open) => !open)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight") return;
              event.preventDefault();
              setCategoryMenuOpen(true);
            }}
          >
            <span>
              {categoryLoadFailed
                ? UI_TEXT.mapping.loadFailed
                : hasValidCategory
                  ? UI_TEXT.mapping.quickChangeCategory
                  : UI_TEXT.mapping.quickSetCategory}
            </span>
          </button>
          {categoryMenuOpen && !loading ? (
            <div
              ref={categoryMenuRef}
              className="quick-app-menu quick-app-category-menu custom-scrollbar"
              role="menu"
              aria-label={UI_TEXT.mapping.quickCategoryMenuLabel}
              style={{ left: categoryPosition.left, top: categoryPosition.top }}
            >
              {categoryOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="quick-app-menu-item quick-app-category-item"
                  role="menuitemradio"
                  aria-checked={option.value === currentCategory}
                  disabled={saving}
                  onClick={() => saveCategory(option)}
                >
                  <span className="quick-app-menu-check" aria-hidden="true">
                    {option.value === currentCategory ? <Check size={14} /> : null}
                  </span>
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <QuietDialog
        open={renameOpen}
        title={UI_TEXT.mapping.quickRenameTitle}
        surfaceClassName="quick-app-rename-dialog"
        initialFocusRef={renameInputRef}
        onClose={() => {
          if (!saving) onClose();
        }}
        actions={(
          <>
            <QuietButton tone="secondary" onClick={() => onClose()} disabled={saving}>
              {UI_TEXT.dialog.cancel}
            </QuietButton>
            <QuietButton
              tone="primary"
              type="submit"
              form="quick-app-rename-form"
              disabled={saving || !renameHasChanges}
            >
              {saving ? UI_TEXT.mapping.quickSaving : UI_TEXT.mapping.quickSave}
            </QuietButton>
          </>
        )}
      >
        <form id="quick-app-rename-form" className="quick-app-rename-form" onSubmit={submitRename}>
          <input
            ref={renameInputRef}
            className="qp-control qp-dialog-input quick-app-rename-input"
            value={renameValue}
            placeholder={UI_TEXT.mapping.quickRenamePlaceholder}
            disabled={saving}
            maxLength={80}
            onChange={(event) => setRenameValue(event.target.value)}
          />
          {ProcessMapper.getUserOverride(target.exeName)?.displayName ? (
            <button
              type="button"
              className="qp-inline-action qp-inline-action-neutral quick-app-restore-name"
              disabled={saving}
              onClick={() => setRenameValue("")}
            >
              {UI_TEXT.mapping.quickRestoreDefaultName}
            </button>
          ) : null}
        </form>
      </QuietDialog>
    </>
  );

  return typeof document === "undefined" ? null : createPortal(menu, document.body);
}
