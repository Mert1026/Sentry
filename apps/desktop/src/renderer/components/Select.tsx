import React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useI18n } from '../lib/i18n.js';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  /** A second, quieter line under the label. */
  readonly description?: string;
}

/**
 * A drop-down in the style of the model picker, in place of the browser's own one: the same trigger, the same
 * floating list and the same keyboard walk (arrows, Enter, Escape), without the search and the model facts.
 */
export function Select({
  id,
  label,
  options,
  value,
  disabled = false,
  onChange,
}: {
  readonly id: string;
  /** The accessible name of the control. */
  readonly label: string;
  readonly options: readonly SelectOption[];
  readonly value: string;
  readonly disabled?: boolean;
  readonly onChange: (value: string) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const root = React.useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!(event.target instanceof Node) || root.current?.contains(event.target) !== true)
        setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const openList = (): void => {
    setActive(
      Math.max(
        options.findIndex((option) => option.value === value),
        0,
      ),
    );
    setOpen(true);
  };
  const choose = (option: SelectOption): void => {
    setOpen(false);
    if (option.value !== value) onChange(option.value);
  };
  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) openList();
      else setActive((index) => Math.min(index + 1, options.length - 1));
    } else if (event.key === 'ArrowUp' && open) {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      const option = options[active];
      if (option !== undefined) choose(option);
    }
  };

  return (
    <div className="model-picker select-picker" ref={root} onKeyDown={onKeyDown}>
      <button
        type="button"
        id={id}
        className="model-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
      >
        <span className="model-picker-value">
          <span className="model-row-name">{selected === undefined ? '' : t(selected.label)}</span>
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open ? (
        <div className="model-picker-popover">
          <ul role="listbox" aria-label={label} className="model-picker-list">
            {options.map((option, index) => (
              <li key={option.value} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  className={'model-row' + (index === active ? ' active' : '')}
                  onClick={() => choose(option)}
                  onMouseEnter={() => setActive(index)}
                >
                  <span className="model-row-main">
                    <span className="model-row-name">{t(option.label)}</span>
                    {option.value === value ? <Check size={14} aria-hidden="true" /> : null}
                  </span>
                  {option.description === undefined ? null : (
                    <span className="model-row-facts">{t(option.description)}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
