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
import { Audio, Video } from "@remotion/media";

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
  blur?: { x: number; y: number; w: number; h: number }[];
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
  blur = [],
}) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const duration = seconds * fps;
  const move = interpolate(
    f,
    [
      0,
      0.65 * fps,
      Math.min(2.5 * fps, duration * 0.4),
      Math.max(duration - 1.2 * fps, duration * 0.6),
      duration - 1,
    ],
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
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: `scale(${1 + 0.035 * (f / duration)})`,
            transformOrigin: "50% 50%",
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
        {blur.map((b, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: b.x,
              top: b.y,
              width: b.w,
              height: b.h,
              backdropFilter: "blur(14px)",
              background: "#0a100c99",
              borderRadius: 4,
            }}
          />
        ))}
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
            fontSize: 26,
          }}
        >
          Windows 11 + WSL2 · Без обещание, че ще бъде открит всеки дефект.
        </div>
      ) : null}
    </AbsoluteFill>
  );
};


type Scene = {
  name: string;
  seconds: number;
  voice?: string;
  props?: Omit<ShotProps, "seconds" | "index">;
  bookend?: "start" | "end";
};

const scenes: Scene[] = [
  { name: "Начало", seconds: 8.5, voice: "n01", bookend: "start" },
  {
    name: "Проект",
    seconds: 6.5,
    voice: "n02",
    props: {
      label: "ПРОЕКТЪТ",
      title: "Всичко започва от твоя проект.",
      note: "Реалният интерфейс на Sentry.",
      source: 6.5,
      rate: 0.75,
      direction: "right",
      blur: [{ x: 296, y: 148, w: 470, h: 34 }],
    },
  },
  {
    name: "Профил",
    seconds: 5,
    voice: "n03",
    props: {
      label: "КОНТЕКСТ",
      title: "Ориентация за всеки агент.",
      note: "Профилът добавя контекст към проучването.",
      source: 41,
      camera: "profile",
    },
  },
  {
    name: "Конфигуриране",
    seconds: 12,
    voice: "n04",
    props: {
      label: "КОНФИГУРИРАНЕ",
      title: "Конфигуриране на QA проверката.",
      note: "Обхват, дълбочина, агенти и разрешения.",
      source: 13,
      rate: 1.1,
      direction: "right",
    },
  },
  {
    name: "Старт",
    seconds: 7,
    voice: "n05",
    props: {
      label: "СТАРТ",
      title: "Потвърждаваш. Агентите започват.",
      note: "Ясна рамка за всяко изпълнение.",
      source: 136.4,
      rate: 1.6,
    },
  },
  {
    name: "Изпълнение",
    seconds: 8,
    voice: "n06",
    props: {
      label: "НА ЖИВО",
      title: "Агентите работят независимо.",
      note: "Етапите на всеки агент са видими.",
      source: 144,
      direction: "right",
    },
  },
  {
    name: "Резултат",
    seconds: 6.5,
    voice: "n07",
    props: {
      label: "ЗАВЪРШЕНО ИЗПЪЛНЕНИЕ",
      title: "Процесът и резултатът са пред теб.",
      note: "Граф, агент, ревизия и находки.",
      source: 72,
    },
  },
  {
    name: "Находки",
    seconds: 9.5,
    voice: "n08",
    props: {
      label: "НАХОДКИ",
      title: "От твърдение към конкретен контекст.",
      note: "Описание, тежест и връзка към кода.",
      source: 81,
      rate: 0.9,
      camera: "findings",
      direction: "right",
    },
  },
  {
    name: "Доказателства",
    seconds: 7,
    voice: "n09",
    props: {
      label: "РЕЗУЛТАТЪТ",
      title: "Увереността започва с доказателство.",
      note: "Провери основанията зад всяка находка.",
      source: 99.5,
      rate: 0.45,
      camera: "details",
    },
  },
  {
    name: "Providers",
    seconds: 4,
    voice: "n10",
    props: {
      label: "PROVIDERS",
      title: "Моделите и настройките ги избираш ти.",
      note: "Контрол върху модела и reasoning effort.",
      source: 181,
      direction: "right",
    },
  },
  {
    name: "Runtime",
    seconds: 3.5,
    props: {
      label: "WSL RUNTIME",
      title: "Времето за работа има ясна рамка.",
      note: "Настройки на изпълнението на едно място.",
      source: 193,
    },
  },
  {
    name: "Инструменти",
    seconds: 6.5,
    voice: "n11",
    props: {
      label: "ИНСТАЛИРАНЕ",
      title: "Ти решаваш какво да се инсталира.",
      note: "Агентите не инсталират инструменти сами.",
      source: 225,
      direction: "right",
    },
  },
  {
    name: "Локално",
    seconds: 6,
    voice: "n12",
    props: {
      label: "НА ТВОЯТА МАШИНА",
      title: "English / Български. Local-first.",
      note: "Проектите и историята остават локално.",
      source: 243,
      rate: 0.08,
    },
  },
  { name: "Финал", seconds: 9, voice: "n13", bookend: "end" },
];

const voiceLengths: Record<string, number> = {
  n01: 8, n02: 4.88, n03: 3.68, n04: 9.76, n05: 5.84, n06: 4.56, n07: 5.52,
  n08: 8.64, n09: 5.84, n10: 6.24, n11: 5.2, n12: 4.96, n13: 7.92,
};
const VOICE_DELAY = 0.4;

const layout = (() => {
  let t = 0;
  return scenes.map((s, i) => {
    const r = { ...s, from: t, index: i + 1 };
    t += s.seconds;
    return r;
  });
})();
export const totalSeconds = layout.reduce((a, s) => a + s.seconds, 0);

const speechWindows = layout
  .filter((s) => s.voice)
  .map((s) => {
    const start = s.from + VOICE_DELAY;
    return [start, start + voiceLengths[s.voice as string]] as const;
  });

export const SentryFilmV3 = () => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill>
      {layout.map((s) => (
        <Sequence
          key={s.name}
          name={`${String(s.index).padStart(2, "0")} — ${s.name}`}
          from={Math.round(s.from * fps)}
          durationInFrames={Math.round(s.seconds * fps)}
        >
          {s.bookend ? (
            <Bookend end={s.bookend === "end"} />
          ) : (
            <ScreenShot
              {...(s.props as Omit<ShotProps, "seconds" | "index">)}
              seconds={s.seconds}
              index={s.index}
            />
          )}
        </Sequence>
      ))}
      {layout
        .filter((s) => s.voice)
        .map((s) => (
          <Sequence
            key={`v-${s.name}`}
            from={Math.round((s.from + VOICE_DELAY) * fps)}
            durationInFrames={
              Math.ceil(voiceLengths[s.voice as string] * fps) + 2
            }
          >
            <Audio src={staticFile(`audio/${s.voice}.mp3`)} volume={1} />
          </Sequence>
        ))}
      <Audio
        src={staticFile("audio/music.mp3")}
        loop
        volume={(f) => {
          const t = f / fps;
          const fadeIn = interpolate(t, [0, 2], [0, 1], bounded);
          const fadeOut = interpolate(
            t,
            [totalSeconds - 3, totalSeconds],
            [1, 0],
            bounded,
          );
          const speaking = speechWindows.some(
            ([a, b]) => t >= a - 0.2 && t <= b + 0.4,
          );
          return (speaking ? 0.14 : 0.3) * fadeIn * fadeOut;
        }}
      />
      <Progress />
    </AbsoluteFill>
  );
};
