interface ToolDurationInputProps {
  id: string;
  label: string;
  minutes: string;
  minMinutes: number;
  maxMinutes: number;
  onMinutesChange: (nextMinutes: string) => void;
  disabled?: boolean;
  hint?: string;
  unit?: string;
}

export default function ToolDurationInput({
  id,
  label,
  minutes,
  minMinutes,
  maxMinutes,
  onMinutesChange,
  disabled = false,
  hint,
  unit,
}: ToolDurationInputProps) {
  return (
    <div className="tools-form-field">
      <div className="tools-field-copy">
        <label htmlFor={id}>{label}</label>
        {hint ? <p>{hint}</p> : null}
      </div>

      <div className="tools-duration-control">
        <input
          id={id}
          type="number"
          min={minMinutes}
          max={maxMinutes}
          step={1}
          value={minutes}
          disabled={disabled}
          onChange={(event) => onMinutesChange(event.target.value)}
          className="qp-input tools-duration-input"
        />
        {unit ? <span className="tools-duration-unit">{unit}</span> : null}
      </div>
    </div>
  );
}
