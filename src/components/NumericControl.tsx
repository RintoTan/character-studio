import { useEffect, useState } from "react";

/**
 * One number, one control.
 *
 * The design panel used to answer "how big?" three different ways depending on the
 * row: a slider with the value printed beside it, a slider with the value hidden in a
 * span, and a row of 小/中/大 buttons. This is the shared answer for every continuous
 * value: a slider for the hand, a field for the head, the unit spelled out, and a way
 * back to the default.
 *
 * Deliberate limits: the field is a text input, not `type=number`, so a half-typed
 * "1." or "-" never becomes a value; committing is what writes, and committing
 * clamps. Typing therefore cannot produce NaN or an out-of-range style.
 */
export type NumericControlProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Shown after the number, e.g. `px` or `%`. */
  unit?: string;
  /** Multiplier applied for display only (0.5 → "50%"). Value stays the raw number. */
  displayScale?: number;
  /** Digits shown in the field. */
  precision?: number;
  /** Where 恢复默认 goes; omit to hide the reset. */
  defaultValue?: number;
  onChange: (value: number) => void;
  ariaLabel?: string;
  testId?: string;
  /** A hint under the row, for values whose meaning is not obvious. */
  hint?: string;
};

const clampTo = (value: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;

const roundTo = (value: number, precision: number) => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

export function NumericControl({
  label,
  value,
  min,
  max,
  step,
  unit,
  displayScale = 1,
  precision = 1,
  defaultValue,
  onChange,
  ariaLabel,
  testId,
  hint,
}: NumericControlProps) {
  const shown = roundTo(value * displayScale, precision).toFixed(precision);
  const [draft, setDraft] = useState(shown);

  // The field follows the value unless the author is mid-edit in it.
  useEffect(() => {
    setDraft(shown);
  }, [shown]);

  const commit = (raw: string) => {
    const cleaned = raw.replace(/[^0-9.+-]/g, "");
    // "abc", "" and "-" are not zero: they are "I changed my mind", so the field goes
    // back to the value the drawing already has.
    if (!/[0-9]/.test(cleaned)) {
      setDraft(shown);
      return;
    }
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) {
      setDraft(shown);
      return;
    }
    const next = roundTo(clampTo(parsed / displayScale, min, max), 3);
    onChange(next);
    setDraft(roundTo(next * displayScale, precision).toFixed(precision));
  };

  const id = testId ? `${testId}-field` : undefined;

  return (
    <div className="nc" data-testid={testId ? `${testId}-wrap` : undefined}>
      <div className="nc-head">
        <span className="nc-label">{label}</span>
        <span className="nc-current">
          <input
            aria-label={ariaLabel ? `${ariaLabel}数值` : `${label}数值`}
            className="nc-field"
            data-testid={id}
            id={id}
            inputMode="decimal"
            onBlur={(event) => commit(event.target.value)}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit((event.target as HTMLInputElement).value);
                (event.target as HTMLInputElement).blur();
              }
              if (event.key === "Escape") {
                setDraft(shown);
                (event.target as HTMLInputElement).blur();
              }
            }}
            value={draft}
          />
          {unit ? <span className="nc-unit">{unit}</span> : null}
        </span>
      </div>
      <div className="nc-row">
        <input
          aria-label={ariaLabel ?? label}
          data-testid={testId}
          max={max}
          min={min}
          onChange={(event) => onChange(roundTo(clampTo(Number(event.target.value), min, max), 3))}
          step={step}
          type="range"
          value={clampTo(value, min, max)}
        />
        {defaultValue !== undefined ? (
          <button
            aria-label={`${label}恢复默认`}
            className="nc-reset"
            disabled={Math.abs(value - defaultValue) < 1e-9}
            onClick={() => onChange(defaultValue)}
            type="button"
          >
            默认
          </button>
        ) : null}
      </div>
      {hint ? <p className="nc-hint">{hint}</p> : null}
    </div>
  );
}
