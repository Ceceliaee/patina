interface Props {
  checked: boolean;
  disabled?: boolean;
  ariaLabel: string;
  onChange: (nextChecked: boolean) => void;
}

export default function QuietSwitch({
  checked,
  disabled = false,
  ariaLabel,
  onChange,
}: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`qp-switch ${checked ? "qp-switch-checked" : ""}`.trim()}
    >
      <span className={`qp-switch-thumb ${checked ? "qp-switch-thumb-checked" : ""}`.trim()} />
    </button>
  );
}
