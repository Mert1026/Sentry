import React from 'react';
import enMessages from '../locales/en.json';
import bgMessages from '../locales/bg.json';
import {
  getLanguage,
  setLanguage,
  useAppPreferences,
  type AppLanguage,
} from './app-preferences.js';

export const TRANSLATIONS: Record<AppLanguage, Readonly<Record<string, string>>> = {
  en: enMessages,
  bg: bgMessages,
};

const BG_MAP: Readonly<Record<string, string>> = bgMessages;

const STATUS_BG: Readonly<Record<string, string>> = {
  ready: 'готов',
  'not ready': 'не е готов',
  unconfigured: 'неконфигуриран',
  configured: 'конфигуриран',
  degraded: 'ограничен',
  unavailable: 'недостъпен',
  unknown: 'неизвестно',
  running: 'изпълнява се',
  agents_running: 'изпълнява се',
  starting: 'стартира',
  planning: 'планиране',
  investigating: 'проучване',
  reporting: 'докладване',
  completed: 'завършено',
  partial: 'частично',
  failed: 'неуспешно',
  cancelled: 'прекъснато',
  timed_out: 'изтекло време',
  'timed out': 'изтекло време',
  interrupted: 'прекъснато',
  waiting: 'изчакване',
  'not started': 'не е стартиран',
  probing: 'проверка',
  connected: 'свързано',
  offline: 'офлайн',
  queued: 'на опашка',
  created: 'създадено',
  preparing: 'подготовка',
  snapshotting: 'създава се снимка',
  collecting: 'събиране',
  canceled: 'прекъснато',
  cancelling: 'прекъсва се',
  skipped: 'пропуснато',
  warning: 'предупреждение',
  error: 'грешка',
  pending: 'в изчакване',
  idle: 'неактивно',
  inactive: 'неактивно',
  active: 'активно',
  unverified: 'непроверено',
  inconclusive: 'неопределено',
  passed: 'преминало',
  fixed: 'поправено',
  blocked: 'блокирано',
  thinking: 'обмисляне',
  stopped: 'спряно',
  stopping: 'спира се',
  installed: 'инсталиран',
  missing: 'липсва',
  built: 'създаден',
  building: 'създава се',
  not_built: 'не е създаден',
  not_started: 'не е стартиран',
  stale: 'остарял',
};
// "timed_out" and "timed out" are the same status.
for (const key of Object.keys(STATUS_BG))
  if (key.includes('_'))
    (STATUS_BG as Record<string, string>)[key.replace(/_/g, ' ')] = STATUS_BG[key] as string;

function translateDurationUnits(raw: string): string {
  return raw
    .replace(/(\d+)h\b/g, '$1ч')
    .replace(/(\d+)m\b/g, '$1м')
    .replace(/(\d+)s\b/g, '$1с');
}

function translateExecutionRuntimeLine(trimmed: string): string | undefined {
  if (!trimmed.startsWith('Execution runtime:')) return undefined;
  return trimmed
    .replace(/^Execution runtime:/, 'Среда за изпълнение:')
    .replace(/\(source:\s*environment\)/i, '(източник: среда)')
    .replace(
      /\(source:\s*managed,\s*Sentry-managed installation\)/i,
      '(източник: управлявана инсталация на Sentry)',
    )
    .replace(/\(source:\s*managed\)/i, '(източник: управляван)')
    .replace(/\(source:\s*path\)/i, '(източник: PATH)')
    .replace(/\(source:\s*explicit\)/i, '(източник: изрично зададен)');
}

const STAGE_LABEL_BG: Record<string, string> = {
  Preparation: 'Подготовка',
  Planning: 'Планиране',
  Investigation: 'Проучване',
  'Commands / Tests': 'Команди / Тестове',
  Evidence: 'Доказателства',
  Reporting: 'Докладване',
  Completed: 'Завършено',
};
const STAGE_STATE_BG: Record<string, string> = {
  observed: 'наблюдавано',
  warning: 'предупреждение',
  active: 'активно',
  'not observed': 'не е наблюдавано',
  completed: 'завършено',
  failed: 'неуспешно',
  'timed out': 'изтекло време',
  interrupted: 'прекъснато',
  cancelled: 'прекъснато',
};
function translateStagePair(label: string, state: string): string | undefined {
  const bgLabel = STAGE_LABEL_BG[label];
  if (bgLabel === undefined) return undefined;
  const bgState = STAGE_STATE_BG[state.toLowerCase()];
  if (bgState === undefined) return undefined;
  return bgLabel + ' ' + bgState;
}
function translateCore(trimmed: string): string {
  if (trimmed.length === 0) return trimmed;
  const exact = BG_MAP[trimmed];
  if (exact !== undefined) return exact;

  const about = /^About (.+)$/.exec(trimmed);
  if (about !== null) return `За ${translateCore(about[1] ?? '')}`;
  const information = /^(.+) information$/.exec(trimmed);
  if (information !== null) return `Информация: ${translateCore(information[1] ?? '')}`;
  const retestDetails = /^Retest details: (.+)$/.exec(trimmed);
  if (retestDetails !== null) return `Детайли за повторната проверка: ${retestDetails[1]}`;
  const retestTab = /^Re-test \((\d+)\)$/.exec(trimmed);
  if (retestTab !== null) return `Повторна проверка (${retestTab[1]})`;
  const retestSummary =
    /^(\d+) resolved · (\d+) not resolved(?: · (\d+) could not be determined)?$/.exec(trimmed);
  if (retestSummary !== null)
    return `${retestSummary[1]} решени · ${retestSummary[2]} не са решени${retestSummary[3] === undefined ? '' : ` · ${retestSummary[3]} не могат да се определят`}`;
  const assessment = /^(.+) assessment$/.exec(trimmed);
  if (assessment !== null) return `Оценка на ${assessment[1]}`;

  const lowerStatus = STATUS_BG[trimmed.toLowerCase().replace(/_/g, ' ')];
  if (lowerStatus !== undefined) {
    return trimmed === trimmed.toUpperCase() && trimmed.length > 1
      ? lowerStatus.toUpperCase()
      : trimmed[0] === trimmed[0]?.toUpperCase()
        ? lowerStatus.charAt(0).toUpperCase() + lowerStatus.slice(1)
        : lowerStatus;
  }

  const execLine = translateExecutionRuntimeLine(trimmed);
  if (execLine !== undefined) return execLine;

  // A bare duration such as "10m 02s" or "1h 05m" (the run header shows the value on its own).
  if (/^\d+[hm] \d{2}[ms]$/.test(trimmed)) return translateDurationUnits(trimmed);
  if (trimmed.startsWith('Started ')) {
    return 'Стартирано ' + trimmed.slice('Started '.length);
  }
  if (trimmed.startsWith('Duration ')) {
    return 'Продължителност ' + translateDurationUnits(trimmed.slice('Duration '.length));
  }
  if (trimmed.startsWith('Cancellation: ')) {
    const st = trimmed.slice('Cancellation: '.length);
    return 'Прекъсване: ' + (STATUS_BG[st.toLowerCase()] ?? st);
  }
  if (trimmed.startsWith('WSL distribution:')) {
    return 'WSL дистрибуция:' + trimmed.slice('WSL distribution:'.length);
  }
  if (trimmed.startsWith('Ecosystem:')) {
    return 'Екосистема:' + trimmed.slice('Ecosystem:'.length);
  }

  const webOptions = /^Web access: (on|off) · tool and SDK downloads: (on|off)$/.exec(trimmed);
  if (webOptions !== null) {
    return `Достъп до интернет: ${webOptions[1] === 'on' ? 'включен' : 'изключен'} · изтегляне на инструменти и SDK: ${webOptions[2] === 'on' ? 'включено' : 'изключено'}`;
  }
  const confirmOptions =
    /^Web access: (on|off) · tool and SDK downloads: (on|off) · package installs: on$/.exec(
      trimmed,
    );
  if (confirmOptions !== null) {
    return `Достъп до интернет: ${confirmOptions[1] === 'on' ? 'включен' : 'изключен'} · изтегляне на инструменти и SDK: ${confirmOptions[2] === 'on' ? 'включено' : 'изключено'} · инсталиране на пакети: включено`;
  }
  const paidAgentCount = /^(\d+) agents? · uses real provider budget\.$/.exec(trimmed);
  if (paidAgentCount !== null)
    return `${paidAgentCount[1]} ${paidAgentCount[1] === '1' ? 'агент' : 'агента'} · изразходва реален бюджет на доставчика.`;
  const usedBy = /^Used by (\d+) agent\(s\)$/.exec(trimmed);
  if (usedBy !== null) return `Използван от ${usedBy[1]} ${usedBy[1] === '1' ? 'агент' : 'агента'}`;
  const withoutProfile = /^(\d+) without \(out of date or not built\)$/.exec(trimmed);
  if (withoutProfile !== null) return `${withoutProfile[1]} без профил (остарял или несъздаден)`;
  const profileUsed =
    /^Project profile: used by (\d+) agent\(s\)(?:, (\d+) without \(out of date or not built\))?$/.exec(
      trimmed,
    );
  if (profileUsed !== null) {
    return `Профил на проекта: използван от ${profileUsed[1]} ${profileUsed[1] === '1' ? 'агент' : 'агента'}${profileUsed[2] === undefined ? '' : `, ${profileUsed[2]} без профил (остарял или несъздаден)`}`;
  }
  const profileAvailable =
    /^(\d+) of (\d+) agents have up-to-date notes\. When enabled, each eligible agent receives only its own profile as unverified context; it must still inspect and test the project\.$/.exec(
      trimmed,
    );
  if (profileAvailable !== null) {
    return `${profileAvailable[1]} от ${profileAvailable[2]} агента имат актуални бележки. Когато опцията е включена, всеки агент с актуален профил получава само своя профил като непроверен контекст и продължава да проверява и тества проекта.`;
  }
  const runScope = /^(\d+) agents? · (Full project|Selected paths) · uses provider budget$/.exec(
    trimmed,
  );
  if (runScope !== null) {
    return `${runScope[1]} ${runScope[1] === '1' ? 'агент' : 'агента'} · ${runScope[2] === 'Full project' ? 'Целият проект' : 'Избрани пътища'} · изразходва бюджет на доставчика`;
  }
  const packs = /^(\d+) packs?, (\d+) versions? installed$/.exec(trimmed);
  if (packs !== null) return `${packs[1]} пакета, ${packs[2]} инсталирани версии`;
  const addons = /^(\d+) installed · your own install command$/.exec(trimmed);
  if (addons !== null) return `${addons[1]} инсталирани · собствена команда за инсталиране`;
  const installedCount = /^(\d+) of (\d+) installed$/.exec(trimmed);
  if (installedCount !== null) return `${installedCount[1]} от ${installedCount[2]} инсталирани`;
  const packCount = /^(\d+) of (\d+) packs$/.exec(trimmed);
  if (packCount !== null) return `${packCount[1]} от ${packCount[2]} пакета`;
  const installAllCount = /^Install all \((\d+)\)$/.exec(trimmed);
  if (installAllCount !== null) return `Инсталирай всички (${installAllCount[1]})`;
  const installAll = /^Install all (.+) versions$/.exec(trimmed);
  if (installAll !== null) return `Инсталирай всички версии на ${installAll[1]}`;
  const installVersions = /^Install (\d+) version\(s\) of (.+)\? About (\d+) MB in total\.$/.exec(
    trimmed,
  );
  if (installVersions !== null)
    return `Инсталиране на ${installVersions[1]} версии на ${installVersions[2]}? Общо около ${installVersions[3]} MB.`;
  const installItems = /^Install (\d+) item\(s\)\? About (\d+) MB in total\.$/.exec(trimmed);
  if (installItems !== null)
    return `Инсталиране на ${installItems[1]} инструмента? Общо около ${installItems[2]} MB.`;
  const customInstall =
    /^Run this command on this machine now\? It installs "(.+)" and runs with your permissions, with network access\.$/.exec(
      trimmed,
    );
  if (customInstall !== null)
    return `Да се изпълни ли командата на тази машина сега? Тя инсталира „${customInstall[1]}“ и се изпълнява с вашите права и достъп до мрежата.`;
  const retest =
    /^Re-test (\d+) finding\(s\) on the current revision with (the agent that reported each|all selected agents)\? This uses provider budget\.$/.exec(
      trimmed,
    );
  if (retest !== null)
    return `Повторна проверка на ${retest[1]} констатации в текущата ревизия с ${retest[2] === 'all selected agents' ? 'всички избрани агенти' : 'агента, докладвал всяка констатация'}? Това изразходва бюджет на доставчика.`;

  const retestInfo =
    /^Select up to (\d+) findings from an older revision and re-test them on the current project revision\. (.+)$/.exec(
      trimmed,
    );
  if (retestInfo !== null)
    return `Изберете до ${retestInfo[1]} констатации от по-стара ревизия и ги проверете повторно в текущата ревизия на проекта. ${translateCore(retestInfo[2] ?? '')}`;
  const retestSelected = /^Re-test (\d+) selected$/.exec(trimmed);
  if (retestSelected !== null) return `Повторна проверка на ${retestSelected[1]} избрани`;
  const exportSelected = /^Export (\d+) selected$/.exec(trimmed);
  if (exportSelected !== null) return `Експортирай ${exportSelected[1]} избрани`;
  const savedFindings = /^Saved (\d+) findings? to (.+)$/.exec(trimmed);
  if (savedFindings !== null)
    return `Запазени ${savedFindings[1]} ${savedFindings[1] === '1' ? 'констатация' : 'констатации'} в ${savedFindings[2]}`;
  const savedCi = /^Saved (\d+) CI files to (.+)$/.exec(trimmed);
  if (savedCi !== null) return `Запазени ${savedCi[1]} CI файла в ${savedCi[2]}`;
  const savedTests = /^Saved (\d+) tests? to (.+)$/.exec(trimmed);
  if (savedTests !== null)
    return `Запазени ${savedTests[1]} ${savedTests[1] === '1' ? 'тест' : 'теста'} в ${savedTests[2]}`;
  const writeTestsConfirm =
    /^Write (\d+) regression test\(s\) with the agents that reported them, in the current revision\? This uses provider budget\. The tests are only kept for download; nothing is added to your project\.$/.exec(
      trimmed,
    );
  if (writeTestsConfirm !== null)
    return `Да се напишат ${writeTestsConfirm[1]} регресионни теста от агентите, които са ги докладвали, в текущата ревизия? Това изразходва бюджет при доставчика. Тестовете се пазят само за изтегляне; нищо не се добавя във вашия проект.`;
  const writeTestsFor = /^Write tests for (\d+) selected$/.exec(trimmed);
  if (writeTestsFor !== null) return `Напиши тестове за ${writeTestsFor[1]} избрани`;
  const testsWritten = /^Tests written for earlier findings \((.+)\):$/.exec(trimmed);
  if (testsWritten !== null)
    return `Написани тестове за по-стари констатации (${testsWritten[1]}):`;
  const pickAtMost = /^Pick at most (\d+)\.$/.exec(trimmed);
  if (pickAtMost !== null) return `Изберете най-много ${pickAtMost[1]}.`;
  const agentRunsFindings = /^(\d+) runs?, (\d+) findings?$/.exec(trimmed);
  if (agentRunsFindings !== null) {
    const runs = Number(agentRunsFindings[1]);
    const findings = Number(agentRunsFindings[2]);
    return `${runs} ${runs === 1 ? 'изпълнение' : 'изпълнения'}, ${findings} ${findings === 1 ? 'констатация' : 'констатации'}`;
  }
  const revisionOption = /^rev (\S+) - (.+?)( \(current\))?$/.exec(trimmed);
  if (revisionOption !== null)
    return `ревизия ${revisionOption[1]} - ${revisionOption[2]}${revisionOption[3] === undefined ? '' : ' (текуща)'}`;
  const locationsEvidence = /^(\d+) locations? · (\d+) evidence$/.exec(trimmed);
  if (locationsEvidence !== null)
    return `${locationsEvidence[1]} ${locationsEvidence[1] === '1' ? 'място' : 'места'} · ${locationsEvidence[2]} доказателства`;
  const moreLocations = /^\(\+(\d+) more\)$/.exec(trimmed);
  if (moreLocations !== null) return `(+още ${moreLocations[1]})`;
  const modeRunStatus = /^(full|targeted|simulation) run (.+)$/.exec(trimmed);
  if (modeRunStatus !== null) {
    const modes: Record<string, string> = {
      full: 'Пълно',
      targeted: 'Целево',
      simulation: 'Симулация на',
    };
    return `${modes[modeRunStatus[1] ?? ''] ?? ''} изпълнение: ${translateCore(modeRunStatus[2] ?? '')}`;
  }
  const runWindow = /^Every run gets a window of (.+?)( \(the default\))?\.$/.exec(trimmed);
  if (runWindow !== null)
    return `Всяко изпълнение получава прозорец от ${translateCore(runWindow[1] ?? '')}${runWindow[2] === undefined ? '' : ' (по подразбиране)'}.`;
  const hoursOnly = /^(\d+) hours?$/.exec(trimmed);
  if (hoursOnly !== null) return hoursOnly[1] === '1' ? '1 час' : `${hoursOnly[1]} часа`;
  const minutesOnly = /^(\d+) minutes?$/.exec(trimmed);
  if (minutesOnly !== null) return minutesOnly[1] === '1' ? '1 минута' : `${minutesOnly[1]} минути`;
  const hoursMinutes = /^(\d+) h (\d+) min$/.exec(trimmed);
  if (hoursMinutes !== null) return `${hoursMinutes[1]} ч ${hoursMinutes[2]} мин`;
  const effortLabel = /^Reasoning effort: (.+)$/.exec(trimmed);
  if (effortLabel !== null) return `Усилие при разсъждение: ${translateCore(effortLabel[1] ?? '')}`;
  const readiness = /^(.+) readiness$/.exec(trimmed);
  if (readiness !== null) return `Готовност на ${readiness[1]}`;
  const installOne = /^Install (.+)\? About (\d+) MB\.$/.exec(trimmed);
  if (installOne !== null) return `Инсталиране на ${installOne[1]}? Около ${installOne[2]} MB.`;
  const usesInstalled = /^Installed: a run uses (.+)\.$/.exec(trimmed);
  if (usesInstalled !== null) return `Инсталирана: изпълнението използва ${usesInstalled[1]}.`;
  // The versions of a toolchain that are installed, listed after its status sentence.
  const installedList = /^Installed: (.+)\.$/.exec(trimmed);
  if (installedList !== null) return `Инсталирани: ${installedList[1]}.`;
  const installVersion = /^Install (\d[\w.+-]*)$/.exec(trimmed);
  if (installVersion !== null) return `Инсталирай ${installVersion[1]}`;
  const wouldUse =
    /^Not installed\. A run would use (.+) instead(; the library has no such version)?\.$/.exec(
      trimmed,
    );
  if (wouldUse !== null)
    return `Не е инсталирана. Изпълнението би използвало ${wouldUse[1] === 'another installed version' ? 'друга инсталирана версия' : wouldUse[1]} вместо нея${wouldUse[2] === undefined ? '' : '; в библиотеката няма такава версия'}.`;
  const exported = /^(JSON|Log) exported$/.exec(trimmed);
  if (exported !== null)
    return exported[1] === 'JSON' ? 'JSON е експортиран' : 'Журналът е експортиран';
  const toolStarted = /^Tool started: (.+)$/.exec(trimmed);
  if (toolStarted !== null) return `Инструментът стартира: ${toolStarted[1]}`;
  const toolCompleted = /^Tool completed: (.+)$/.exec(trimmed);
  if (toolCompleted !== null) return `Инструментът завърши: ${toolCompleted[1]}`;
  const readFile = /^Read (\S*[./\\]\S*|unknown file)$/.exec(trimmed);
  if (readFile !== null)
    return `Прочетен файл ${readFile[1] === 'unknown file' ? 'неизвестен' : readFile[1]}`;
  const fileChanged = /^File (\S*[./\\]\S*|unknown)$/.exec(trimmed);
  if (fileChanged !== null)
    return `Файл ${fileChanged[1] === 'unknown' ? 'неизвестен' : fileChanged[1]}`;
  const testSuite = /^Test: (.+)$/.exec(trimmed);
  if (testSuite !== null)
    return `Тест: ${testSuite[1] === 'unnamed suite' ? 'безименен набор' : testSuite[1]}`;
  const passedFailed = /^(\d+) passed, (\d+) failed$/.exec(trimmed);
  if (passedFailed !== null) return `${passedFailed[1]} успешни, ${passedFailed[2]} неуспешни`;
  const findingEvent = /^Finding: (.+)$/.exec(trimmed);
  if (findingEvent !== null)
    return `Констатация: ${findingEvent[1] === 'submitted' ? 'подадена' : findingEvent[1]}`;
  const agentStatus = /^Agent status: (.*)$/.exec(trimmed);
  if (agentStatus !== null) return `Състояние на агента: ${translateCore(agentStatus[1] ?? '')}`;
  const exitCode = /^exit (-?\d+)$/.exec(trimmed);
  if (exitCode !== null) return `код на изход ${exitCode[1]}`;
  const relativePaths = /^Paths must be project-relative \(no leading \/ or \.\.\): (.+)$/.exec(
    trimmed,
  );
  if (relativePaths !== null)
    return `Пътищата трябва да са относителни към проекта (без начално / или ..): ${relativePaths[1]}`;
  const copyId = /^Copy ([a-z]+_\S+)$/.exec(trimmed);
  if (copyId !== null) return `Копирай ${copyId[1]}`;
  const retestLimit = /^A retest takes between 1 and (\d+) findings\.$/.exec(trimmed);
  if (retestLimit !== null)
    return `Повторната проверка приема от 1 до ${retestLimit[1]} констатации.`;
  const notInProject = /^Run (\S+) is not part of this project$/.exec(trimmed);
  if (notInProject !== null) return `Изпълнението ${notInProject[1]} не е част от този проект`;
  const findingMissing = /^Finding (\S+) was not found$/.exec(trimmed);
  if (findingMissing !== null) return `Констатацията ${findingMissing[1]} не е намерена`;
  if (trimmed === 'The same finding was listed twice.')
    return 'Една и съща констатация е посочена два пъти.';

  const runsMatch = /^(\d+)\s+runs?$/.exec(trimmed);
  if (runsMatch !== null) {
    const count = runsMatch[1];
    return count === '1' ? '1 изпълнение' : `${count} изпълнения`;
  }

  const activeRunMatch = /^(\d+)\s+(?:(last known active|active))\s+runs?(?:\s*·\s*Open)?$/.exec(
    trimmed,
  );
  if (activeRunMatch !== null) {
    const count = activeRunMatch[1];
    const hasOpen = trimmed.endsWith('Open');
    const base = count === '1' ? '1 активно изпълнение' : `${count} активни изпълнения`;
    return hasOpen ? `${base} · Отвори` : base;
  }

  const inProgressMatch = /^(\d+)\s+QA\s+runs?\s+in\s+progress$/.exec(trimmed);
  if (inProgressMatch !== null) {
    const count = inProgressMatch[1];
    return count === '1' ? '1 QA изпълнение в ход' : `${count} QA изпълнения в ход`;
  }

  const selectedAgentsMatch = /^([\d,]+)\s+selected\s+agents?$/.exec(trimmed);
  if (selectedAgentsMatch !== null) {
    const count = selectedAgentsMatch[1];
    return count === '1' ? '1 избран агент' : `${count} избрани агента`;
  }

  const selectedMatch = /^([\d,]+)\s+selected$/.exec(trimmed);
  if (selectedMatch !== null) {
    const count = selectedMatch[1];
    return count === '1' ? '1 избран' : `${count} избрани`;
  }

  const findingsEvidenceMatch = /^([\d,]+)\s+(total\s+)?findings?\s*·\s*([\d,]+)\s+evidence$/.exec(
    trimmed,
  );
  if (findingsEvidenceMatch !== null) {
    const fCount = findingsEvidenceMatch[1];
    const isTotal = Boolean(findingsEvidenceMatch[2]);
    const eCount = findingsEvidenceMatch[3];
    const fLabel = fCount === '1' ? 'констатация' : 'констатации';
    const eLabel = eCount === '1' ? 'доказателство' : 'доказателства';
    const totalWord = isTotal ? 'общо ' : '';
    return `${fCount} ${totalWord}${fLabel} · ${eCount} ${eLabel}`;
  }

  const agentSummaryMatch =
    /^(\d+)\s+running\s*·\s*(\d+)\s+completed\s*·\s*(\d+)\s+failed\s*\/\s*timed\s+out\s*\/\s*interrupted$/.exec(
      trimmed,
    );
  if (agentSummaryMatch !== null) {
    return `${agentSummaryMatch[1]} активни · ${agentSummaryMatch[2]} завършени · ${agentSummaryMatch[3]} неуспешни / изтекли / прекъснати`;
  }

  const findingsCountMatch = /^([\d,]+)\s+findings?$/.exec(trimmed);
  if (findingsCountMatch !== null) {
    const count = findingsCountMatch[1];
    return count === '1' ? '1 констатация' : `${count} констатации`;
  }

  const evidenceCountMatch = /^([\d,]+)\s+evidence$/.exec(trimmed);
  if (evidenceCountMatch !== null) {
    const count = evidenceCountMatch[1];
    return count === '1' ? '1 доказателство' : `${count} доказателства`;
  }

  const tabCountMatch = /^(Findings|Evidence)\s*\((\d+)\)$/.exec(trimmed);
  if (tabCountMatch !== null) {
    const tabName = tabCountMatch[1] === 'Findings' ? 'Констатации' : 'Доказателства';
    return `${tabName} (${tabCountMatch[2]})`;
  }

  const modeProdMatch = /^(FULL|TARGETED)\s+QA\s*·\s*(Production|Legacy simulation)$/i.exec(
    trimmed,
  );
  if (modeProdMatch !== null) {
    const modeLabel = modeProdMatch[1]?.toUpperCase() === 'FULL' ? 'ПЪЛЕН QA' : 'ЦЕЛЕВИ QA';
    const kindLabel =
      modeProdMatch[2]?.toLowerCase() === 'production' ? 'Продукция' : 'Симулация (наследена)';
    return `${modeLabel} · ${kindLabel}`;
  }

  const analysisStatusMatch = /^Analysis\s+(cancelled|failed|partial)\.?$/i.exec(trimmed);
  if (analysisStatusMatch !== null) {
    const st = analysisStatusMatch[1]?.toLowerCase();
    if (st === 'cancelled') return 'Анализът е прекъснат.';
    if (st === 'failed') return 'Анализът е неуспешен.';
    if (st === 'partial') return 'Анализът е частичен.';
  }

  const runSummaryMatch = /^([?\d]+)\/([?\d]+)\s+agents\s*·\s*(\d+)\s+findings$/.exec(trimmed);
  if (runSummaryMatch !== null) {
    return `${runSummaryMatch[1]}/${runSummaryMatch[2]} агента · ${runSummaryMatch[3]} констатации`;
  }

  const bareModeMatch = /^(FULL|TARGETED)\s+QA$/.exec(trimmed);
  if (bareModeMatch !== null) {
    return bareModeMatch[1] === 'FULL' ? 'ПЪЛЕН QA' : 'ЦЕЛЕВИ QA';
  }

  const runsRevMatch = /^(\d+)\s+runs?\s*·\s*rev\s+(.+)$/.exec(trimmed);
  if (runsRevMatch !== null) {
    const count = runsRevMatch[1];
    const rev = runsRevMatch[2];
    return count === '1' ? `1 изпълнение · rev ${rev}` : `${count} изпълнения · rev ${rev}`;
  }

  const openRecentMatch = /^Open most recent active run\. (\d+) active runs?$/.exec(trimmed);
  if (openRecentMatch !== null) {
    const count = openRecentMatch[1];
    return count === '1'
      ? 'Отвори последното активно изпълнение. 1 активно изпълнение'
      : `Отвори последното активно изпълнение. ${count} активни изпълнения`;
  }

  const removeProjectMatch = /^Remove project (.+)$/.exec(trimmed);
  if (removeProjectMatch !== null) {
    return `Премахни проект ${removeProjectMatch[1]}`;
  }

  const removeHeadingMatch = /^Remove (.+)\?$/.exec(trimmed);
  if (removeHeadingMatch !== null) {
    return `Премахни ${removeHeadingMatch[1]}?`;
  }

  const createdMatch = /^(\d+)\s+created$/.exec(trimmed);
  if (createdMatch !== null) {
    return `${createdMatch[1]} създадени`;
  }

  const targetedPathsMatch = /^TARGETED\s*·\s*(\d+)\s+paths?$/.exec(trimmed);
  if (targetedPathsMatch !== null) {
    const count = targetedPathsMatch[1];
    return count === '1' ? 'ЦЕЛЕВИ · 1 път' : `ЦЕЛЕВИ · ${count} пътя`;
  }

  const severityBreakdownMatch =
    /^(\d+)\s+Critical\s*·\s*(\d+)\s+High\s*·\s*(\d+)\s+Medium\s*·\s*(\d+)\s+Low\s*·\s*(\d+)\s+Info$/.exec(
      trimmed,
    );
  if (severityBreakdownMatch !== null) {
    const [, critical, high, medium, low, info] = severityBreakdownMatch;
    return `${critical} критични · ${high} високи · ${medium} средни · ${low} ниски · ${info} информационни`;
  }

  const paletteEntryMatch = /^(Open Project|Start Full QA|Start Targeted QA) — (.+)$/.exec(trimmed);
  if (paletteEntryMatch !== null) {
    const action =
      paletteEntryMatch[1] === 'Open Project'
        ? 'Отвори проект'
        : paletteEntryMatch[1] === 'Start Full QA'
          ? 'Стартирай ПЪЛЕН QA'
          : 'Стартирай ЦЕЛЕВИ QA';
    return `${action} — ${paletteEntryMatch[2]}`;
  }

  const ioCountersMatch = /^Input ([^·]+) · Output ([^·]+) · Cached ([^·]+)$/.exec(trimmed);
  if (ioCountersMatch !== null) {
    return `Вход ${(ioCountersMatch[1] ?? '').trim()} · Изход ${(ioCountersMatch[2] ?? '').trim()} · Кеширани ${(ioCountersMatch[3] ?? '').trim()}`;
  }

  const severityCountMatch = /^(critical|high|medium|low|info): (\d+)$/.exec(trimmed);
  if (severityCountMatch !== null) {
    const forms: Record<string, [string, string]> = {
      critical: ['критична', 'критични'],
      high: ['висока', 'високи'],
      medium: ['средна', 'средни'],
      low: ['ниска', 'ниски'],
      info: ['информационна', 'информационни'],
    };
    const sevKey = severityCountMatch[1] ?? '';
    const sevCount = severityCountMatch[2] ?? '';
    const [singular, plural] = forms[sevKey] ?? [sevKey, sevKey];
    return `${sevCount === '1' ? singular : plural}: ${sevCount}`;
  }

  const beforeStatusMatch =
    /^No findings were reported before (timed out|failed|cancelled|interrupted)\. Analysis is incomplete\.$/.exec(
      trimmed,
    );
  if (beforeStatusMatch !== null) {
    const beforeKey = beforeStatusMatch[1] ?? '';
    const st = STATUS_BG[beforeKey] ?? beforeKey;
    return `Не са докладвани констатации преди ${st}. Анализът е непълен.`;
  }

  const partialReportMatch =
    /^Partial report — agent (timed out|failed|cancelled|interrupted)\. Reported findings and evidence are retained; analysis is incomplete\.$/.exec(
      trimmed,
    );
  if (partialReportMatch !== null) {
    const partialKey = partialReportMatch[1] ?? '';
    const st = STATUS_BG[partialKey] ?? partialKey;
    return `Частичен доклад — агент ${st}. Докладваните констатации и доказателства се запазват; анализът е непълен.`;
  }

  const rawEventsMatch = /^Raw events \((\d+)\)$/.exec(trimmed);
  if (rawEventsMatch !== null) {
    return `Сурови събития (${rawEventsMatch[1]})`;
  }

  const stagePairMatch =
    /^(Preparation|Planning|Investigation|Commands \/ Tests|Evidence|Reporting|Completed)\s+(.+)$/.exec(
      trimmed,
    );
  if (stagePairMatch !== null) {
    const translatedStage = translateStagePair(stagePairMatch[1] ?? '', stagePairMatch[2] ?? '');
    if (translatedStage !== undefined) return translatedStage;
  }
  const stageListPrefix = 'Stage: ';
  if (trimmed.startsWith(stageListPrefix)) {
    const stageItems = trimmed.slice(stageListPrefix.length).split(', ');
    const translatedItems = stageItems.map((item) => translateText(item, 'bg'));
    if (translatedItems.some((t, i) => t !== stageItems[i]))
      return 'Етап: ' + translatedItems.join(', ');
  }
  const dashIndex = trimmed.indexOf(' — ');
  if (dashIndex > 0) {
    const leftSource = trimmed.slice(0, dashIndex);
    const rightSource = trimmed.slice(dashIndex + 3);
    const leftText = translateText(leftSource, 'bg');
    const rightText = translateText(rightSource, 'bg');
    if (leftText !== leftSource || rightText !== rightSource) return leftText + ' — ' + rightText;
  }
  const agentActivityMatch =
    /^([^\s]+?)\s+(running|planning|completed|failed|timed\s+out|interrupted|investigating|reporting|starting|probing)$/.exec(
      trimmed,
    );
  if (agentActivityMatch !== null) {
    const name = agentActivityMatch[1];
    const statusKey = agentActivityMatch[2]?.toLowerCase().replace(/\s+/, ' ') ?? '';
    const statusBg = STATUS_BG[statusKey];
    if (statusBg !== undefined) {
      return `${name} ${statusBg}`;
    }
  }

  // Interpolated sentences render as a single text node (template literal
  // in JSX), so they never match the dictionary and need frame handlers.
  // Dynamic values (distro names, model ids, sizes) pass through untranslated.
  const reclaimBodyMatch =
    /^Sentry will stop its runtime and shut down WSL to compact the (.+) disk\. Save work and close other applications using WSL, including Docker and terminals\. If another distribution is running, Sentry will refuse\. Windows will request administrator approval\. Keep Sentry open until compaction finishes\. Your files are kept, and the disk can grow again as needed\. The amount reclaimed may be zero\.$/.exec(
      trimmed,
    );
  if (reclaimBodyMatch !== null) {
    return `Sentry ще спре средата за изпълнение и ще изключи WSL, за да компактира диска ${reclaimBodyMatch[1] ?? ''}. Запазете работата си и затворете другите приложения, използващи WSL, включително Docker и терминали. Ако работи друга дистрибуция, Sentry ще откаже. Windows ще поиска администраторско одобрение. Дръжте Sentry отворен, докато компактирането завърши. Файловете ви се запазват, а дискът може да порасне отново при нужда. Освободеното количество може да е нула.`;
  }

  const reclaimedMatch =
    /^Reclaimed ([\d.]+ GiB) from the (.+) disk\. Windows drive free: ([\d.]+ GiB)\.( Sentry reconnected\.)?$/.exec(
      trimmed,
    );
  if (reclaimedMatch !== null) {
    return `Освободени ${reclaimedMatch[1] ?? ''} от диска ${reclaimedMatch[2] ?? ''}. Свободно място на Windows устройството: ${reclaimedMatch[3] ?? ''}.${reclaimedMatch[4] !== undefined ? ' Sentry се свърза отново.' : ''}`;
  }

  const savedModelMatch =
    /^Saved model “(.+)” is not in the current list\. It is preserved — select a listed model above or keep this custom id\.$/.exec(
      trimmed,
    );
  if (savedModelMatch !== null) {
    return `Запазеният модел „${savedModelMatch[1] ?? ''}“ не е в текущия списък. Запазен е — изберете модел от списъка по-горе или задръжте този потребителски идентификатор.`;
  }

  const legacyNoteMatch = /^(\S+) is a (.+)\. Your saved value is preserved\.$/.exec(trimmed);
  if (legacyNoteMatch !== null) {
    return `${legacyNoteMatch[1] ?? ''} е ${legacyNoteMatch[2] ?? ''}. Запазената стойност е съхранена.`;
  }

  const savedProviderMatch =
    /^Saved provider “(.+)” is unrecognized\. It is preserved — select a supported provider above before saving\.$/.exec(
      trimmed,
    );
  if (savedProviderMatch !== null) {
    return `Запазеният доставчик „${savedProviderMatch[1] ?? ''}“ е неразпознат. Запазен е — изберете поддържан доставчик по-горе преди запазване.`;
  }

  const keepSavedMatch = /^Keep saved “(.+)” \(unrecognized\)$/.exec(trimmed);
  if (keepSavedMatch !== null) {
    return `Задръж запазеното „${keepSavedMatch[1] ?? ''}“ (неразпознато)`;
  }

  const activeUpstreamMatch = /^Active upstream: (.+)$/.exec(trimmed);
  if (activeUpstreamMatch !== null) {
    return `Активен доставчик: ${activeUpstreamMatch[1] ?? ''}`;
  }

  // Revision picker option: id and formatted date pass through, only the
  // recency marker translates.
  const currentRevisionMatch = /^(\S+) · (.+) · current$/.exec(trimmed);
  if (currentRevisionMatch !== null) {
    return `${currentRevisionMatch[1] ?? ''} · ${currentRevisionMatch[2] ?? ''} · текуща`;
  }

  return trimmed;
}

export function translateText(text: string, language: AppLanguage = getLanguage()): string {
  if (language === 'en') return text;
  const trimmed = text.trim();
  if (trimmed.length === 0) return text;
  const translated = translateCore(trimmed);
  if (translated === trimmed) return text;
  const start = text.indexOf(trimmed);
  const lead = text.slice(0, start);
  const tail = text.slice(start + trimmed.length);
  return lead + translated + tail;
}

export function useI18n(): {
  readonly language: AppLanguage;
  readonly setLanguage: (language: AppLanguage) => void;
  readonly t: (text: string) => string;
} {
  const { language } = useAppPreferences();
  const t = React.useCallback((text: string) => translateText(text, language), [language]);
  return { language, setLanguage, t };
}

const originalTextNodes = new WeakMap<Text, string>();
const lastWrittenTextNodes = new WeakMap<Text, string>();

function shouldSkipElement(el: Element | null): boolean {
  if (el === null) return true;
  // Skip code blocks, preformatted JSON, and dynamic agent message/finding descriptions
  return (
    el.closest('code, pre, [data-no-translate="true"], .event-row, .finding-title, .live-line') !==
    null
  );
}

function translateSubtree(root: HTMLElement, language: AppLanguage): void {
  if (typeof document === 'undefined') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode() as Text | null;
  while (current !== null) {
    const parent = current.parentElement;
    if (!shouldSkipElement(parent)) {
      const value = current.nodeValue ?? '';
      const lastWritten = lastWrittenTextNodes.get(current);
      // If React updated the text node underneath us, refresh the stored English source
      if (!originalTextNodes.has(current) || (lastWritten !== undefined && value !== lastWritten)) {
        originalTextNodes.set(current, value);
      }
      const source = originalTextNodes.get(current) ?? value;
      const target = language === 'en' ? source : translateText(source, 'bg');
      if (current.nodeValue !== target) {
        lastWrittenTextNodes.set(current, target);
        current.nodeValue = target;
      } else {
        lastWrittenTextNodes.set(current, value);
      }
    }
    current = walker.nextNode() as Text | null;
  }
  const inputs = root.querySelectorAll('input[placeholder], textarea[placeholder]');
  for (const el of inputs) {
    if (shouldSkipElement(el)) continue;
    translateElementAttribute(el, 'placeholder', language);
  }
  // Tooltips and accessible names follow the interface language too.
  const labelled = root.querySelectorAll('[title], [aria-label]');
  for (const el of labelled) {
    if (shouldSkipElement(el)) continue;
    translateElementAttribute(el, 'title', language);
    translateElementAttribute(el, 'aria-label', language);
  }
}

const originalAttributes = new WeakMap<Element, Map<string, string>>();
const lastWrittenAttributes = new WeakMap<Element, Map<string, string>>();

function translateElementAttribute(el: Element, attr: string, language: AppLanguage): void {
  const current = el.getAttribute(attr);
  if (current === null || current.trim().length === 0) return;
  let sources = originalAttributes.get(el);
  if (sources === undefined) {
    sources = new Map<string, string>();
    originalAttributes.set(el, sources);
  }
  let written = lastWrittenAttributes.get(el);
  if (written === undefined) {
    written = new Map<string, string>();
    lastWrittenAttributes.set(el, written);
  }
  const last = written.get(attr);
  // If React updated the attribute underneath us, refresh the stored English source.
  if (!sources.has(attr) || (last !== undefined && current !== last)) {
    sources.set(attr, current);
  }
  const source = sources.get(attr) ?? current;
  const target = language === 'en' ? source : translateText(source, 'bg');
  if (current !== target) {
    written.set(attr, target);
    el.setAttribute(attr, target);
  } else {
    written.set(attr, current);
  }
}

export function useDomTranslationObserver(
  rootRef: React.RefObject<HTMLElement | null>,
  language: AppLanguage,
): void {
  React.useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    translateSubtree(root, language);
    if (language === 'en' || typeof MutationObserver === 'undefined') return;
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (rootRef.current !== null && getLanguage() === 'bg') {
          translateSubtree(rootRef.current, 'bg');
        }
      });
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['placeholder', 'title', 'aria-label'],
    });
    return () => observer.disconnect();
  }, [rootRef, language]);
}
