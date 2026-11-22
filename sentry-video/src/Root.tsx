import { Composition } from "remotion";
import { SentryFilmV3, totalSeconds } from "./FilmV3";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Sentry-Presentation-BG"
        component={SentryFilmV3}
        durationInFrames={Math.round(totalSeconds * 30)}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
