import React from "react";
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  staticFile,
} from "remotion";
import { Video } from "@remotion/media";

const green = "#b5ed62",
  muted = "#a2b29f";
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const Mark = () => (
  <Img
    src={staticFile("sentry-logo.png")}
    style={{ width: 55, height: 55, objectFit: "contain" }}
  />
);
const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        background: "#090f0b",
        color: "#f3f7ee",
        fontFamily: "Segoe UI, Arial, sans-serif",
        overflow: "hidden",
      }}
    >
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at 78% 28%, #25401c 0%, transparent 58%)",
          opacity: 0.65,
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(#b5ed6208 1px, transparent 1px),linear-gradient(90deg,#b5ed6208 1px, transparent 1px)",
          backgroundSize: "80px 80px",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 45,
          left: 88,
          display: "flex",
          alignItems: "center",
          gap: 17,
        }}
      >
        <Mark />
        <span style={{ fontSize: 29, fontWeight: 700, letterSpacing: 6 }}>
          SENTRY
        </span>
      </div>
      <div
        style={{
          position: "absolute",
          right: 90,
          top: 60,
          color: muted,
          fontSize: 19,
          letterSpacing: 4,
        }}
      >
        НЕЗАВИСИМИ АГЕНТИ. ПРОВЕРИМИ РЕЗУЛТАТИ.
      </div>
      {children}
      <div
        style={{
          position: "absolute",
          bottom: 32,
          left: 90,
          color: muted,
          fontSize: 19,
        }}
      >
        QA платформа с ИИ
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 32,
          right: 90,
          color: muted,
          fontSize: 19,
        }}
      >
        SENTRY / ПРЕДСТАВЯНЕ
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          height: 4,
          width: `${(f / 9000) * 100}%`,
          background: green,
        }}
      />
    </AbsoluteFill>
  );
};
const Entrance: React.FC<{ children: React.ReactNode; seconds: number }> = ({
  children,
  seconds,
}) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill
      style={{
        opacity: interpolate(
          f,
          [0, 15, seconds * fps - 12, seconds * fps - 1],
          [0, 1, 1, 0],
          clamp,
        ),
        translate: `0 ${interpolate(f, [0, 24], [24, 0], clamp)}px`,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};
const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      fontSize: 23,
      color: green,
      letterSpacing: 4,
      fontWeight: 600,
      marginBottom: 24,
    }}
  >
    {children}
  </div>
);
const Chips: React.FC<{ items: string[] }> = ({ items }) => (
  <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 35 }}>
    {items.map((t) => (
      <div
        key={t}
        style={{
          padding: "15px 23px",
          border: "1px solid #b5ed6238",
          borderRadius: 12,
          color: green,
          fontSize: 25,
          background: "#122016",
        }}
      >
        {t}
      </div>
    ))}
  </div>
);
type SceneProps = {
  label: string;
  title: string;
  body: string;
  seconds: number;
};
const Hero: React.FC<SceneProps & { accent: string; chips?: string[] }> = ({
  label,
  title,
  accent,
  body,
  seconds,
  chips = [],
}) => (
  <Entrance seconds={seconds}>
    <div style={{ position: "absolute", left: 150, right: 150, top: 260 }}>
      <Label>{label}</Label>
      <div
        style={{
          fontSize: 96,
          fontWeight: 650,
          lineHeight: 1.14,
          letterSpacing: -3,
        }}
      >
        {title}
        <br />
        <span style={{ color: green }}>{accent}</span>
      </div>
      <div
        style={{
          fontSize: 35,
          color: muted,
          lineHeight: 1.55,
          marginTop: 35,
          maxWidth: 1390,
        }}
      >
        {body}
      </div>
      <Chips items={chips} />
    </div>
  </Entrance>
);
const Cards: React.FC<SceneProps & { cards: [string, string][] }> = ({
  label,
  title,
  body,
  cards,
  seconds,
}) => {
  const f = useCurrentFrame();
  return (
    <Entrance seconds={seconds}>
      <div style={{ position: "absolute", left: 110, right: 110, top: 185 }}>
        <Label>{label}</Label>
        <div style={{ fontSize: 70, fontWeight: 650, letterSpacing: -2 }}>
          {title}
        </div>
        <p
          style={{
            fontSize: 32,
            color: muted,
            margin: "22px 0 55px",
            maxWidth: 1550,
            lineHeight: 1.5,
          }}
        >
          {body}
        </p>
        <div style={{ display: "flex", gap: 26 }}>
          {cards.map(([a, b], i) => (
            <div
              key={a}
              style={{
                flex: 1,
                background: "linear-gradient(145deg,#19281b,#0d1710)",
                border: "1px solid #b5ed6233",
                borderRadius: 24,
                padding: 36,
                minHeight: 260,
                opacity: interpolate(f, [i * 8, 24 + i * 8], [0, 1], clamp),
              }}
            >
              <div style={{ color: green, fontSize: 22, marginBottom: 33 }}>
                0{i + 1} /
              </div>
              <div style={{ fontSize: 37, fontWeight: 600, lineHeight: 1.2 }}>
                {a}
              </div>
              <div
                style={{
                  fontSize: 27,
                  color: muted,
                  lineHeight: 1.5,
                  marginTop: 22,
                }}
              >
                {b}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Entrance>
  );
};
const Demo: React.FC<
  SceneProps & {
    start: number;
    rate?: number;
    focus?: "all" | "right" | "center";
  }
> = ({ label, title, body, start, seconds, rate = 1, focus = "all" }) => {
  const { fps } = useVideoConfig();
  const f = useCurrentFrame();
  const zoom = focus === "all" ? 1 : focus === "right" ? 1.58 : 1.25;
  return (
    <Entrance seconds={seconds}>
      <div style={{ position: "absolute", left: 105, top: 143, right: 105 }}>
        <Label>{label}</Label>
        <div style={{ fontSize: 58, fontWeight: 650, letterSpacing: -1.5 }}>
          {title}
        </div>
        <div style={{ fontSize: 28, color: muted, marginTop: 16 }}>{body}</div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 140,
          top: 335,
          width: 1640,
          height: 650,
          borderRadius: 19,
          overflow: "hidden",
          border: "1px solid #a7d36755",
          boxShadow: "0 32px 100px #0009",
          background: "#0b120c",
        }}
      >
        <Video
          muted
          src={staticFile("footage/source-safe.mp4")}
          trimBefore={start * fps}
          playbackRate={rate}
          style={{
            position: "absolute",
            width: 1640,
            height: 922.5,
            top: -54,
            left: 0,
            transformOrigin: focus === "right" ? "95% 45%" : "52% 42%",
            transform: `scale(${zoom + interpolate(f, [0, 450], [0, 0.018], clamp)})`,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 17,
            left: 20,
            background: "#08110de8",
            border: "1px solid #b5ed6244",
            borderRadius: 8,
            padding: "9px 15px",
            color: green,
            fontSize: 17,
            letterSpacing: 2,
          }}
        >
          ЗАПИС ОТ ПРИЛОЖЕНИЕТО
        </div>
      </div>
    </Entrance>
  );
};
const Compare = () => (
  <Entrance seconds={15}>
    <div style={{ position: "absolute", left: 140, right: 140, top: 190 }}>
      <Label>ОТ МНЕНИЕ КЪМ ПРОЦЕС</Label>
      <div style={{ fontSize: 72, fontWeight: 650, marginBottom: 55 }}>
        Разликата е в проверимостта.
      </div>
      <div style={{ display: "flex", gap: 32 }}>
        {[
          [
            "Чат с ИИ",
            "Един отговор",
            "Твърдения в текст",
            "Ръчно проследяване",
          ],
          [
            "Sentry",
            "Независими проучвания",
            "Команди и доказателства",
            "Ревизии и повторен тест",
          ],
        ].map((col, i) => (
          <div
            key={col[0]}
            style={{
              flex: 1,
              padding: 40,
              border: "1px solid " + (i ? "#b5ed6266" : "#ffffff20"),
              background: i ? "#19291b" : "#121813",
              borderRadius: 24,
            }}
          >
            <div
              style={{
                fontSize: 42,
                color: i ? green : muted,
                fontWeight: 650,
                marginBottom: 25,
              }}
            >
              {col[0]}
            </div>
            {col.slice(1).map((t) => (
              <div
                key={t}
                style={{
                  fontSize: 31,
                  padding: "25px 0",
                  borderTop: "1px solid #ffffff15",
                }}
              >
                {t}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  </Entrance>
);

export const SentryFilm = () => {
  const { fps } = useVideoConfig();
  return (
    <Shell>
      <Sequence name="01 — Въпросът" durationInFrames={20 * fps}>
        <Hero
          seconds={20}
          label="КОЛКО СТРУВА ЕДНО ТВЪРДЕНИЕ?"
          title="„Намери бъговете.“"
          accent="А кое е доказано?"
          body="Увереният отговор е само начало. За реална QA проверка са нужни действия, наблюдения и възпроизводими резултати."
          chips={["Вероятно…", "Може би…", "Какво показва проверката?"]}
        />
      </Sequence>
      <Sequence
        name="02 — Проблемът"
        from={20 * fps}
        durationInFrames={20 * fps}
      >
        <Cards
          seconds={20}
          label="ДОВЕРИЕТО ИСКА ОСНОВАНИЕ"
          title="Отговорът трябва да може да се провери."
          body="Когато няма видима проверка, увереността на модела не е доказателство."
          cards={[
            ["Какво е изпълнено?", "Конкретна команда, а не предположение."],
            ["Какво е наблюдавано?", "Изходът, който подкрепя находката."],
            ["Може ли да се повтори?", "Ясна следа от твърдение до резултат."],
          ]}
        />
      </Sequence>
      <Sequence name="03 — Sentry" from={40 * fps} durationInFrames={15 * fps}>
        <Hero
          seconds={15}
          label="ПРЕДСТАВЯМЕ"
          title="Sentry"
          accent="QA с проверими основания."
          body="Няколко независими ИИ агента проучват проекта. Всяко твърдение има своята следа към доказателството."
          chips={["Независимост", "Доказателства", "История"]}
        />
      </Sequence>
      <Sequence
        name="04 — Независимост"
        from={55 * fps}
        durationInFrames={20 * fps}
      >
        <Cards
          seconds={20}
          label="01 / НЕЗАВИСИМОСТ"
          title="Една ревизия. Отделни проучвания."
          body="Всеки агент работи със собствено копие на замразения проект. Докладите остават отделни."
          cards={[
            ["OpenCode", "Собствен план. Собствен доклад."],
            ["DeepSeek", "Независимо проучване на същата ревизия."],
            ["GLM / ChatGPT", "Резултатите на всеки агент поотделно."],
          ]}
        />
      </Sequence>
      <Sequence
        name="05 — Доказателства"
        from={75 * fps}
        durationInFrames={20 * fps}
      >
        <Cards
          seconds={20}
          label="02 / ДОКАЗАТЕЛСТВА"
          title="Тежестта на твърдението има значение."
          body="Находката показва на какво се основава. Потвърждението изисква възпроизвеждане."
          cards={[
            ["Потвърдено", "Наблюдавано при реална проверка."],
            ["Силно", "Подкрепено от преглед на кода."],
            ["Спекулативно", "Разсъждение, което още изисква проверка."],
          ]}
        />
      </Sequence>
      <Sequence
        name="06 — Безопасност"
        from={95 * fps}
        durationInFrames={10 * fps}
      >
        <Hero
          seconds={10}
          label="03 / БЕЗОПАСНОСТ"
          title="Проучване в копие."
          accent="Контрол върху средата."
          body="Управлявано работно копие, изрично разрешена среда и изолирано изпълнение."
          chips={["Оригиналът се запазва", "Санирана среда", "Sandbox"]}
        />
      </Sequence>
      <Sequence
        name="07 — Оценяване"
        from={105 * fps}
        durationInFrames={15 * fps}
      >
        <Cards
          seconds={15}
          label="04 / ИЗМЕРИМО КАЧЕСТВО"
          title="Проверяваме и самата проверка."
          body="Оценителен набор със скрит еталон за агентите."
          cards={[
            ["Известни дефекти", "Проекти със заложени бъгове."],
            ["Чист проект", "Проверка за фалшиви тревоги."],
            ["Враждебен README", "Проверка срещу подвеждащи инструкции."],
          ]}
        />
      </Sequence>
      <Sequence name="08 — Проект" from={120 * fps} durationInFrames={15 * fps}>
        <Demo
          seconds={15}
          label="ДА ГО ВИДИМ / ПРОЕКТ"
          title="Проектът е отправната точка."
          body="Управлявано копие и ревизия, към която резултатите могат да се върнат."
          start={35}
          rate={0.8}
        />
      </Sequence>
      <Sequence
        name="09 — Конфигуриране"
        from={135 * fps}
        durationInFrames={15 * fps}
      >
        <Demo
          seconds={15}
          label="КОНФИГУРИРАНЕ"
          title="Избираш обхват, агенти и дълбочина."
          body="Full или Targeted QA. Fast за кратък план, Full за по-задълбочено проучване."
          start={12}
          rate={0.65}
        />
      </Sequence>
      <Sequence
        name="10 — Изпълнение"
        from={150 * fps}
        durationInFrames={20 * fps}
      >
        <Demo
          seconds={20}
          label="ПРОЦЕСЪТ Е ВИДИМ"
          title="От подготовката до доклада."
          body="План → проучване → задълбочаване → рискови места → доклад"
          start={144}
          rate={0.65}
          focus="center"
        />
      </Sequence>
      <Sequence name="11 — Време" from={170 * fps} durationInFrames={10 * fps}>
        <Hero
          seconds={10}
          label="РЕЗЕРВ ЗА ДОКЛАДА"
          title="Ограничено време."
          accent="Честен резултат."
          body="Ако проучването изчерпи времето си, резервът за доклад запазва наблюдаваното като частичен резултат."
        />
      </Sequence>
      <Sequence
        name="12 — Находки"
        from={180 * fps}
        durationInFrames={10 * fps}
      >
        <Demo
          seconds={10}
          label="РЕЗУЛТАТИ"
          title="Находката има контекст."
          body="Тежест, описание, местоположение и доказателства. Експорт в JSON или лог."
          start={80}
          rate={0.7}
          focus="right"
        />
      </Sequence>
      <Sequence
        name="13 — История"
        from={190 * fps}
        durationInFrames={15 * fps}
      >
        <Cards
          seconds={15}
          label="ИСТОРИЯ ПО РЕВИЗИИ"
          title="Знаеш какво е проверено и кога."
          body="Находките остават свързани с версията на проекта и с агента, който ги е докладвал."
          cards={[
            ["Ревизия", "Конкретен момент от проекта."],
            ["Агент", "Отделен източник и собствен доклад."],
            ["Доказателство", "Проверима следа към резултата."],
          ]}
        />
      </Sequence>
      <Sequence
        name="14 — Повторен тест"
        from={205 * fps}
        durationInFrames={15 * fps}
      >
        <Cards
          seconds={15}
          label="RE-TEST"
          title="Поправено ли е на сегашната версия?"
          body="Избираш стари находки за повторна проверка. Историята им се запазва."
          cards={[
            ["Преминал", "Повторната проверка минава."],
            ["Не е преминал", "Резултат с конкретна причина."],
            ["Не е завършил", "Ясно отбелязана непълна проверка."],
          ]}
        />
      </Sequence>
      <Sequence
        name="15 — Контрол"
        from={220 * fps}
        durationInFrames={15 * fps}
      >
        <Demo
          seconds={15}
          label="НАСТРОЙКИ"
          title="Ти определяш рамката на проучването."
          body="Избор на модел, reasoning effort и времеви лимит за изпълнението."
          start={169}
          rate={1.2}
        />
      </Sequence>
      <Sequence
        name="16 — Toolchains"
        from={235 * fps}
        durationInFrames={15 * fps}
      >
        <Demo
          seconds={15}
          label="TOOLCHAINS"
          title="Нужните инструменти. Под твой контрол."
          body="Версии според проекта. Инсталирането става с твое действие."
          start={219}
          rate={0.85}
        />
      </Sequence>
      <Sequence
        name="17 — Профил и CLI"
        from={250 * fps}
        durationInFrames={15 * fps}
      >
        <Demo
          seconds={15}
          label="КОНТЕКСТ И АВТОМАТИЗАЦИЯ"
          title="Ориентация за агентите. CLI за процесите."
          body="Профил на проекта с непроверени бележки. JSON за автоматизация и CI."
          start={37}
          rate={0.7}
        />
      </Sequence>
      <Sequence name="18 — Локално" from={265 * fps} durationInFrames={5 * fps}>
        <Hero
          seconds={5}
          label="LOCAL-FIRST"
          title="Историята е при теб."
          accent="English / Български"
          body="Проектите и историята остават на твоята машина."
        />
      </Sequence>
      <Sequence
        name="19 — Сравнение"
        from={270 * fps}
        durationInFrames={15 * fps}
      >
        <Compare />
      </Sequence>
      <Sequence
        name="20 — Честно обещание"
        from={285 * fps}
        durationInFrames={10 * fps}
      >
        <Hero
          seconds={10}
          label="ЧЕСТНОТО ОБЕЩАНИЕ"
          title="Не всеки бъг."
          accent="Ясно основание за всяка находка."
          body="Sentry не гарантира, че намира всеки дефект. Недоказаното остава обозначено като недоказано."
        />
      </Sequence>
      <Sequence name="21 — Финал" from={295 * fps} durationInFrames={5 * fps}>
        <Hero
          seconds={5}
          label="SENTRY · WINDOWS 11 + WSL2"
          title="Провери проекта."
          accent="Проследи доказателството."
          body="github.com/Mert1026/Sentry"
        />
      </Sequence>
    </Shell>
  );
};
