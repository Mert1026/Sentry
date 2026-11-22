import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Video } from "@remotion/media";

const accent = "#b5ed62";
const bounded = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
  easing: Easing.bezier(0.22, 0.8, 0.3, 1),
} as const;
// Source-space camera bounds. Each rectangle keeps the full subject in view.
// The wide frame removes only the 40px operating-system title/menu bar.
const cameras = {
  wide: { x: 0, y: 40, w: 1280 },
  agents: { x: 390, y: 285, w: 800 },
  findings: { x: 580, y: 310, w: 700 },
  details: { x: 430, y: 266, w: 850 },
  selection: { x: 0, y: 40, w: 1280 },
  profile: { x: 195, y: 160, w: 1050 },
};
type Camera = keyof typeof cameras;
type ShotProps = {
  label: string;
  title: string;
  note: string;
  source: number;
  seconds: number;
  rate?: number;
  camera?: Camera;
  direction?: "left" | "right";
  index: number;
};

const Progress = () => {
  const f = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        height: 3,
        left: 0,
        width: `${(f / durationInFrames) * 100}%`,
        background: accent,
      }}
    />
  );
};

const ScreenShot: React.FC<ShotProps> = ({
  label,
  title,
  note,
  source,
  seconds,
  rate = 1,
  camera = "wide",
  direction = "left",
  index,
}) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = seconds * fps;
  const move = interpolate(
    f,
    [0, 0.65 * fps, 2.5 * fps, duration - 1.2 * fps, duration - 1],
    [0, 0, 1, 1, 0],
    bounded,
  );
  const c = cameras[camera];
  const w = 1280 + (c.w - 1280) * move;
  const x = c.x * move,
    y = 40 + (c.y - 40) * move;
  const scale = 1792 / w;
  return (
    <AbsoluteFill
      style={{
        background: "#080d09",
        fontFamily: "Segoe UI, Arial, sans-serif",
        color: "#f4f8ef",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 61,
          top: 25,
          display: "flex",
          alignItems: "center",
          gap: 24,
          opacity: interpolate(f, [0, 9], [0, 1], bounded),
          translate: `${interpolate(f, [0, 18], [direction === "left" ? -28 : 28, 0], bounded)}px 0`,
        }}
      >
        <Img
          src={staticFile("sentry-logo.png")}
          style={{ width: 55, height: 55 }}
        />
        <div>
          <div
            style={{
              fontSize: 16,
              color: accent,
              letterSpacing: 3,
              marginBottom: 5,
            }}
          >
            {label}
          </div>
          <div style={{ fontSize: 35, fontWeight: 600, letterSpacing: -0.7 }}>
            {title}
          </div>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          right: 65,
          top: 30,
          width: 490,
          textAlign: "right",
          fontSize: 21,
          lineHeight: 1.4,
          color: "#a8b5a3",
          opacity: interpolate(f, [10, 23], [0, 1], bounded),
        }}
      >
        {note}
      </div>
      <div
        style={{
          position: "absolute",
          left: 64,
          top: 108,
          width: 1792,
          height: 952,
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid #9ac56135",
          opacity: interpolate(f, [0, 7], [0, 1], bounded),
          translate: `0 ${interpolate(f, [0, 18], [14, 0], bounded)}px`,
        }}
      >
        <Video
          muted
          src={staticFile("footage/source-safe.mp4")}
          trimBefore={source * fps}
          playbackRate={rate}
          style={{
            position: "absolute",
            width: 1280 * scale,
            height: 720 * scale,
            left: -x * scale,
            top: -y * scale,
            maxWidth: "none",
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          right: 80,
          bottom: 34,
          fontSize: 14,
          color: accent,
          background: "#08100be8",
          padding: "5px 10px",
          borderRadius: 5,
          opacity: 0.8,
        }}
      >
        SENTRY / {String(index).padStart(2, "0")}
      </div>
    </AbsoluteFill>
  );
};

const Bookend: React.FC<{ end?: boolean }> = ({ end = false }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill
      style={{
        background: "#080d09",
        fontFamily: "Segoe UI, Arial, sans-serif",
        color: "#f5f9f0",
      }}
    >
      <Video
        muted
        src={staticFile("footage/source-safe.mp4")}
        trimBefore={(end ? 82 : 3.2) * fps}
        playbackRate={0.65}
        objectFit="cover"
        style={{
          width: "100%",
          height: "100%",
          opacity: 0.35,
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(90deg,#080d09f5,#080d0999 60%,#080d0966)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 145,
          top: 220,
          opacity: interpolate(f, [0, 14], [0, 1], bounded),
          translate: `${interpolate(f, [0, 30], [-60, 0], bounded)}px 0`,
        }}
      >
        <Img
          src={staticFile("sentry-logo.png")}
          style={{ width: 115, height: 115, marginBottom: 25 }}
        />
        <div
          style={{
            fontSize: 30,
            color: accent,
            letterSpacing: 10,
            marginBottom: 20,
          }}
        >
          SENTRY
        </div>
        <div
          style={{
            fontSize: 90,
            fontWeight: 650,
            lineHeight: 1.12,
            letterSpacing: -2,
          }}
        >
          {end ? "Провери проекта." : "От „може би“"}
          <br />
          <span style={{ color: accent }}>
            {end ? "Виж доказателството." : "до реална проверка."}
          </span>
        </div>
        <div style={{ fontSize: 30, color: "#bcc8b5", marginTop: 35 }}>
          {end
            ? "github.com/Mert1026/Sentry"
            : "Независими ИИ агенти. Проверими резултати."}
        </div>
      </div>
      {end ? (
        <div
          style={{
            position: "absolute",
            left: 145,
            bottom: 100,
            color: "#9caa95",
            fontSize: 21,
          }}
        >
          Windows 11 + WSL2 · Без обещание, че ще бъде открит всеки дефект.
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

export const SentryFilmV2 = () => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill>
      <Sequence name="01 — Начало" durationInFrames={5 * fps}>
        <Bookend />
      </Sequence>
      <Sequence name="02 — Проект" from={5 * fps} durationInFrames={8 * fps}>
        <ScreenShot
          index={2}
          label="ПРОЕКТЪТ"
          title="Всичко започва от твоя проект."
          note="Реалният интерфейс на Sentry."
          source={6.5}
          seconds={8}
          rate={0.75}
          direction="right"
        />
      </Sequence>
      <Sequence name="03 — Профил" from={13 * fps} durationInFrames={7 * fps}>
        <ScreenShot
          index={3}
          label="КОНТЕКСТ"
          title="Ориентация за всеки агент."
          note="Профилът добавя контекст към проучването."
          source={41}
          seconds={7}
          camera="profile"
        />
      </Sequence>
      <Sequence
        name="04 — Конфигуриране"
        from={20 * fps}
        durationInFrames={22 * fps}
      >
        <ScreenShot
          index={4}
          label="КОНФИГУРИРАНЕ"
          title="Конфигуриране на QA проверката."
          note="Обхват, дълбочина, агенти и разрешения."
          source={13}
          seconds={22}
          rate={0.8}
          camera="wide"
          direction="right"
        />
      </Sequence>
      <Sequence
        name="07 — Инструменти"
        from={42 * fps}
        durationInFrames={7 * fps}
      >
        <ScreenShot
          index={7}
          label="ПОДГОТОВКА"
          title="Виж какво е нужно на проекта."
          note="Средата и инструментите са видими преди старта."
          source={48}
          seconds={7}
          rate={0.7}
        />
      </Sequence>
      <Sequence
        name="08 — Завършен run"
        from={49 * fps}
        durationInFrames={8 * fps}
      >
        <ScreenShot
          index={8}
          label="ЗАВЪРШЕНО ИЗПЪЛНЕНИЕ"
          title="Процесът и резултатът са пред теб."
          note="Граф, агент, ревизия и находки."
          source={72}
          seconds={8}
          direction="right"
        />
      </Sequence>
      <Sequence name="09 — Находки" from={57 * fps} durationInFrames={8 * fps}>
        <ScreenShot
          index={9}
          label="НАХОДКИ"
          title="От твърдение към конкретен контекст."
          note="Описание, тежест и връзка към кода."
          source={81}
          seconds={8}
          camera="findings"
        />
      </Sequence>
      <Sequence name="11 — Експорт" from={65 * fps} durationInFrames={14 * fps}>
        <ScreenShot
          index={11}
          label="ДОКЛАД"
          title="Резултат, който можеш да проследиш."
          note="JSON и лог за последващ анализ."
          source={75.3}
          seconds={14}
          rate={0.35}
          camera="details"
        />
      </Sequence>
      <Sequence
        name="12 — Нова проверка"
        from={79 * fps}
        durationInFrames={7 * fps}
      >
        <ScreenShot
          index={12}
          label="СЛЕДВАЩО ПРОУЧВАНЕ"
          title="Конфигурираш проверката според задачата."
          note="Обхват, агенти и опции на изпълнението."
          source={112}
          seconds={7}
          direction="right"
        />
      </Sequence>
      <Sequence
        name="13 — Стартиране"
        from={86 * fps}
        durationInFrames={7 * fps}
      >
        <ScreenShot
          index={13}
          label="СТАРТ"
          title="Потвърждаваш. Агентите започват."
          note="Ясна рамка за всяко изпълнение."
          source={136.4}
          seconds={7}
          rate={1.6}
        />
      </Sequence>
      <Sequence name="16 — Среда" from={93 * fps} durationInFrames={7 * fps}>
        <ScreenShot
          index={16}
          label="ENVIRONMENT"
          title="Средата е част от проверката."
          note="Runtime, CLI и състояние на агентите."
          source={166}
          seconds={7}
          direction="right"
        />
      </Sequence>
      <Sequence
        name="17 — Providers"
        from={100 * fps}
        durationInFrames={9 * fps}
      >
        <ScreenShot
          index={17}
          label="PROVIDERS"
          title="Моделите и настройките ги избираш ти."
          note="Контрол върху модела и reasoning effort."
          source={181}
          seconds={9}
          rate={0.9}
        />
      </Sequence>
      <Sequence name="18 — Runtime" from={109 * fps} durationInFrames={8 * fps}>
        <ScreenShot
          index={18}
          label="WSL RUNTIME"
          title="Времето за работа има ясна рамка."
          note="Настройки на изпълнението на едно място."
          source={191}
          seconds={8}
          direction="right"
        />
      </Sequence>
      <Sequence
        name="19 — Toolchains"
        from={117 * fps}
        durationInFrames={9 * fps}
      >
        <ScreenShot
          index={19}
          label="TOOLCHAINS"
          title="Инструментите, които проектът изисква."
          note="Библиотека с пакети и версии."
          source={216}
          seconds={9}
        />
      </Sequence>
      <Sequence name="20 — Пакети" from={126 * fps} durationInFrames={9 * fps}>
        <ScreenShot
          index={20}
          label="ИНСТАЛИРАНЕ"
          title="Ти решаваш какво да се инсталира."
          note="Агентите не инсталират инструменти сами."
          source={225}
          seconds={9}
          direction="right"
        />
      </Sequence>
      <Sequence name="21 — Език" from={135 * fps} durationInFrames={8 * fps}>
        <ScreenShot
          index={21}
          label="НА ТВОЯТА МАШИНА"
          title="English / Български. Local-first."
          note="Проектите и историята остават локално."
          source={243}
          seconds={8}
          rate={0.08}
        />
      </Sequence>
      <Sequence
        name="22 — Доказателства"
        from={143 * fps}
        durationInFrames={8 * fps}
      >
        <ScreenShot
          index={22}
          label="РЕЗУЛТАТЪТ"
          title="Увереността започва с доказателство."
          note="Провери основанията зад всяка находка."
          source={99.5}
          seconds={8}
          rate={0.45}
          camera="details"
          direction="right"
        />
      </Sequence>
      <Sequence
        name="23 — Проследимост"
        from={151 * fps}
        durationInFrames={8 * fps}
      >
        <ScreenShot
          index={23}
          label="SENTRY"
          title="Независимост. Доказателства. История."
          note="Процес, към който можеш да се върнеш."
          source={94}
          seconds={8}
          rate={0.5}
        />
      </Sequence>
      <Sequence name="24 — Финал" from={159 * fps} durationInFrames={6 * fps}>
        <Bookend end />
      </Sequence>
      <Progress />
    </AbsoluteFill>
  );
};
