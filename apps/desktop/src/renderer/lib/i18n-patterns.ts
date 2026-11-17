/**
 * Bulgarian patterns for interface text that is built from parts: counts, names, "Label: value"
 * pairs and sentences with a value inside. `translate` is the exact-match translator, so a name or a
 * status that has its own entry is translated inside the sentence as well.
 */
type Translate = (text: string) => string;

const plural = (n: string, one: string, many: string): string => (n === '1' ? one : many);

interface Rule {
  readonly re: RegExp;
  /** The translation, or undefined to let the next rule try. */
  readonly to: (m: RegExpExecArray, translate: Translate) => string | undefined;
}

const RULES: readonly Rule[] = [
  // Buttons and accessible names that carry a name.
  { re: /^Ask (.+) what it needs$/, to: (m) => `Попитай ${m[1]} какво му е нужно` },
  { re: /^Build profile for (.+)$/, to: (m) => `Създай профил за ${m[1]}` },
  { re: /^Rebuild profile for (.+)$/, to: (m) => `Създай профила отново за ${m[1]}` },
  { re: /^(.+) provider settings$/, to: (m) => `Настройки на доставчика ${m[1]}` },
  { re: /^Note for (.+)$/, to: (m) => `Бележка за ${m[1]}` },
  { re: /^Custom value for (.+)$/, to: (m) => `Собствена стойност за ${m[1]}` },
  { re: /^Value for (.+)$/, to: (m) => `Стойност за ${m[1]}` },
  {
    re: /^Copy full ID(?: (.+))?$/,
    to: (m) => `Копирай пълния ID${m[1] === undefined ? '' : ' ' + m[1]}`,
  },
  { re: /^Copy (\S+)$/, to: (m) => `Копирай ${m[1]}` },
  { re: /^Deselect ([A-Z].*)$/, to: (m) => `Премахни избора на ${m[1]}` },
  { re: /^Select ([A-Z].*)$/, to: (m) => `Избери ${m[1]}` },
  { re: /^Inspect (.+)$/, to: (m, t) => `Прегледай ${t(m[1] ?? '')}` },
  { re: /^Edit (.+)$/, to: (m) => `Редактирай ${m[1]}` },
  { re: /^Remove (.+)$/, to: (m) => `Премахни ${m[1]}` },
  { re: /^Add (\S+)$/, to: (m) => `Добави ${m[1]}` },
  { re: /^Install (\S.* \d[\w.+-]*)$/, to: (m) => `Инсталирай ${m[1]}` },
  { re: /^Raw events \((\d+)\)$/, to: (m) => `Сурови събития (${m[1]})` },
  // Counts.
  {
    re: /^(\d+) of (\d+) selected agent executions completed$/,
    to: (m) => `${m[1]} от ${m[2]} избрани изпълнения на агенти са завършени`,
  },
  { re: /^of (\d+) packs$/, to: (m) => `от ${m[1]} пакета` },
  {
    re: /^(\d+) QA runs? in progress$/,
    to: (m) => `${m[1]} QA ${plural(m[1] ?? '', 'изпълнение', 'изпълнения')} в ход`,
  },
  {
    re: /^(\d+) active runs?(?: · Open)?$/,
    to: (m) =>
      `${m[1]} ${plural(m[1] ?? '', 'активно изпълнение', 'активни изпълнения')}${m[0].endsWith('Open') ? ' · Отвори' : ''}`,
  },
  {
    re: /^Open most recent active run\. (\d+) active runs?$/,
    to: (m) =>
      `Отвори най-скорошното активно изпълнение. ${m[1]} ${plural(m[1] ?? '', 'активно изпълнение', 'активни изпълнения')}`,
  },
  {
    re: /^TARGETED · (\d+) paths?$/,
    to: (m) => `ЦЕЛЕВО · ${m[1]} ${plural(m[1] ?? '', 'път', 'пътя')}`,
  },
  { re: /^· (\d+) could not be determined$/, to: (m) => `· ${m[1]} не могат да се определят` },
  { re: /^(\d+) could not be determined$/, to: (m) => `${m[1]} не могат да се определят` },
  { re: /^(\d+) resolved$/, to: (m) => `${m[1]} решени` },
  { re: /^(\d+) not resolved$/, to: (m) => `${m[1]} не са решени` },
  { re: /^Input (\S+)$/, to: (m) => `Вход ${m[1]}` },
  { re: /^Output (\S+)$/, to: (m) => `Изход ${m[1]}` },
  { re: /^Cached (\S+)$/, to: (m) => `Кеширани ${m[1]}` },
  { re: /^(\d+) paths?$/, to: (m) => `${m[1]} ${plural(m[1] ?? '', 'път', 'пътя')}` },
  // Sentences with a value inside.
  {
    re: /^No findings were reported before (.+)\. Analysis is incomplete\.$/,
    to: (m, t) =>
      `Не са докладвани констатации преди състоянието „${t(m[1] ?? '')}“. Анализът е непълен.`,
  },
  {
    re: /^Partial report — agent (.+)\. Reported findings and evidence are retained; analysis is incomplete\.$/,
    to: (m, t) =>
      `Частичен доклад — агентът е със състояние „${t(m[1] ?? '')}“. Докладваните констатации и доказателства се запазват; анализът е непълен.`,
  },
  {
    re: /^Analysis (.+)\.$/,
    to: (m, t) => {
      const status = t(m[1] ?? '');
      return status === m[1] ? undefined : `Анализът е със състояние „${status}“.`;
    },
  },
  {
    re: /^Project is in use by (.+)\. Update cannot start until the run finishes\.$/,
    to: (m) =>
      `Проектът се използва от ${m[1]}. Обновяването не може да започне, докато изпълнението не приключи.`,
  },
  {
    re: /^Node (\S+) · Protocol v(\S+) · Sentry (\S+)$/,
    to: (m) => `Node ${m[1]} · Протокол v${m[2]} · Sentry ${m[3]}`,
  },
  { re: /^· rev (\S+)$/, to: (m) => `· ревизия ${m[1]}` },
  {
    re: /^Reclaimed (.+) from the (.+) disk\. Windows drive free: (.+)$/,
    to: (m) => `Освободени ${m[1]} от диска на ${m[2]}. Свободно на Windows устройството: ${m[3]}`,
  },
  {
    re: /^Sentry will stop its runtime and shut down WSL to compact the (.+) disk\. (.+)$/,
    to: (m, t) =>
      `Sentry ще спре средата си за изпълнение и ще изключи WSL, за да свие диска на ${m[1]}. ${t(m[2] ?? '')}`,
  },
  {
    re: /^Saved model “(.*)” is not in the current list\. It is preserved — select a listed model above or keep this custom id\.$/,
    to: (m) =>
      `Запазеният модел „${m[1]}“ не е в текущия списък. Той се запазва — изберете модел от списъка по-горе или запазете този собствен идентификатор.`,
  },
  {
    re: /^Saved provider “(.*)” is unrecognized\. It is preserved — select a supported provider above before saving\.$/,
    to: (m) =>
      `Запазеният доставчик „${m[1]}“ не е разпознат. Той се запазва — изберете поддържан доставчик по-горе, преди да запазите.`,
  },
  { re: /^Keep saved “(.*)” \(unrecognized\)$/, to: (m) => `Запази „${m[1]}“ (неразпознат)` },
  {
    re: /^(.+) is a (.+)\. Your saved value is preserved\.$/,
    to: (m, t) => `${m[1]} е ${t(m[2] ?? '')}. Запазената ви стойност се пази.`,
  },
  {
    re: /^(.+): use an absolute Linux path, not a Windows path\.$/,
    to: (m) => `${m[1]}: използвайте абсолютен Linux път, а не Windows път.`,
  },
  {
    re: /^No (critical|high|medium|low|info) findings from this agent\.$/,
    to: (m, t) => {
      const cap = (m[1] ?? '').charAt(0).toUpperCase() + (m[1] ?? '').slice(1);
      return `Няма ${t(cap).toLowerCase()} констатации от този агент.`;
    },
  },
  {
    re: /^(.+) \(WSL(\d*), (.+)\)$/,
    to: (m, t) => `${m[1]} (WSL${m[2]}, ${t(m[3] ?? '')})`,
  },
  {
    re: /^No (.+) activity\.$/,
    to: (m, t) => {
      const cap = (m[1] ?? '').charAt(0).toUpperCase() + (m[1] ?? '').slice(1);
      const label = t(cap);
      return label === cap ? undefined : `Няма активност от вида „${label}“.`;
    },
  },
  { re: /^e\.g\. (.+)$/, to: (m) => `напр. ${(m[1] ?? '').replace(/, or /g, ' или ')}` },
  { re: /^PATH: (.+)$/, to: (m) => `PATH: ${m[1]}` },
  { re: /^openrouter \(default\)$/, to: () => 'openrouter (по подразбиране)' },
  { re: /^no model saved$/, to: () => 'няма запазен модел' },
];

/** The translation of text that no exact entry covers, or `text` itself when nothing applies. */
export function translatePatterns(text: string, translate: Translate): string {
  for (const rule of RULES) {
    const m = rule.re.exec(text);
    if (m === null) continue;
    const done = rule.to(m, translate);
    if (done !== undefined) return done;
  }

  // "Label: value" (accessible names and tooltips such as "Web access: On").
  const pair = /^([^:·]{2,40}): (.+)$/.exec(text);
  if (pair !== null) {
    const label = translate(pair[1] ?? '');
    const value = translate(pair[2] ?? '');
    if (label !== pair[1] || value !== pair[2]) return `${label}: ${value}`;
  }

  // Parts joined by " · " (a leading "· " belongs to the part after it).
  if (text.includes('·')) {
    const lead = text.startsWith('· ') ? '· ' : '';
    const parts = text.slice(lead.length).split(' · ');
    if (parts.length > 1 || lead !== '') {
      const done = parts.map((part) => translate(part));
      if (done.some((part, i) => part !== parts[i])) return lead + done.join(' · ');
    }
  }
  return text;
}
