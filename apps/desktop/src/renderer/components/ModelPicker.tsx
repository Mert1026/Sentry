import React from 'react';
import { Check, ChevronDown, PencilLine, Search } from 'lucide-react';
import { formatDateTime } from '../lib/date-format.js';
import {
  filterModelOptions,
  formatContext,
  isCurrentOption,
  type ModelOption,
} from '../lib/model-options.js';
import { useI18n } from '../lib/i18n.js';

/**
 * A searchable list of models, in place of a plain drop-down: each row shows the model's name and its exact id,
 * a badge when it is new (from the last update of the list) or older, and its context size and release date. The
 * last row lets the person write an id the list does not have.
 */
export function ModelPicker({
  id,
  label,
  options,
  value,
  customActive,
  placeholder,
  onSelect,
  onCustom,
}: {
  readonly id: string;
  /** The accessible name of the control. */
  readonly label: string;
  readonly options: readonly ModelOption[];
  /** The id of the chosen option, or '' when none is chosen. */
  readonly value: string;
  /** True while the person is writing their own id. */
  readonly customActive: boolean;
  readonly placeholder: string;
  readonly onSelect: (id: string) => void;
  readonly onCustom: () => void;
}): React.JSX.Element {
  const { language, t } = useI18n();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const root = React.useRef<HTMLDivElement | null>(null);
  const search = React.useRef<HTMLInputElement | null>(null);
  const shown = React.useMemo(() => filterModelOptions(options, query), [options, query]);
  const current = shown.filter(isCurrentOption);
  const older = shown.filter((option) => !isCurrentOption(option));
  // The order the rows are drawn in is the order the arrow keys walk.
  const ordered = [...current, ...older];
  const selected = options.find((option) => option.id === value);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!(event.target instanceof Node) || root.current?.contains(event.target) !== true)
        setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);
  React.useEffect(() => {
    if (open) search.current?.focus();
  }, [open]);
  React.useEffect(() => setActive(0), [query]);

  const close = (): void => {
    setOpen(false);
    setQuery('');
  };
  const choose = (option: ModelOption): void => {
    onSelect(option.id);
    close();
  };
  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, Math.max(ordered.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = ordered[active];
      if (option !== undefined) choose(option);
    }
  };

  const row = (option: ModelOption): React.JSX.Element => {
    const index = ordered.indexOf(option);
    const facts = [
      option.note === undefined ? undefined : t(option.note),
      formatContext(option.context) === undefined
        ? undefined
        : formatContext(option.context) + ' ' + t('context'),
      option.releasedAt === undefined
        ? undefined
        : formatDateTime(option.releasedAt, language, true),
    ].filter((fact): fact is string => fact !== undefined);
    return (
      <li key={option.id} role="presentation">
        <button
          type="button"
          role="option"
          aria-selected={option.id === value}
          className={'model-row' + (index === active ? ' active' : '')}
          onClick={() => choose(option)}
          onMouseEnter={() => setActive(index)}
        >
          <span className="model-row-main">
            <span className="model-row-name">{option.name}</span>
            {option.badge === undefined ? null : (
              <span className={'model-badge ' + option.badge}>
                {option.badge === 'new' ? 'New' : 'Legacy'}
              </span>
            )}
            {option.id === value ? <Check size={14} aria-hidden="true" /> : null}
          </span>
          <span className="model-row-id mono">{option.id}</span>
          {facts.length === 0 ? null : <span className="model-row-facts">{facts.join(' · ')}</span>}
        </button>
      </li>
    );
  };

  return (
    <div className="model-picker" ref={root} onKeyDown={onKeyDown}>
      <button
        type="button"
        id={id}
        className="model-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="model-picker-value">
          {selected !== undefined ? (
            <>
              <span className="model-row-name">{selected.name}</span>
              {selected.name === selected.id ? null : (
                <span className="model-row-id mono">{selected.id}</span>
              )}
            </>
          ) : customActive ? (
            <span className="model-row-name">{t('Custom model id…')}</span>
          ) : (
            <span className="model-picker-placeholder">{t(placeholder)}</span>
          )}
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open ? (
        <div className="model-picker-popover">
          <label className="model-picker-search">
            <Search size={14} aria-hidden="true" />
            <input
              ref={search}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('Search models…')}
              aria-label="Search models"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <ul role="listbox" aria-label={label} className="model-picker-list">
            {ordered.length === 0 ? (
              <li role="presentation" className="metadata model-picker-empty">
                {t('No model matches')}
              </li>
            ) : null}
            {current.length > 0 ? (
              <>
                {older.length > 0 ? (
                  <li role="presentation" className="model-group-title">
                    {t('Current models')}
                  </li>
                ) : null}
                {current.map(row)}
              </>
            ) : null}
            {older.length > 0 ? (
              <>
                <li role="presentation" className="model-group-title">
                  {t('Older models')}
                </li>
                {older.map(row)}
              </>
            ) : null}
          </ul>
          <button
            type="button"
            className="model-row model-row-custom"
            onClick={() => {
              onCustom();
              close();
            }}
          >
            <PencilLine size={14} aria-hidden="true" />
            <span className="model-row-name">{t('Custom model id…')}</span>
            <span className="model-row-facts">{t('Write an id this list does not have')}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
