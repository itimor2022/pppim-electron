import "xgplayer/dist/index.min.css";

import { memo, useEffect, useRef } from "react";
import { I18N, SimplePlayer } from "xgplayer";
import ZH from "xgplayer/es/lang/zh-cn";
import Error from "xgplayer/es/plugins/error";
import Fullscreen from "xgplayer/es/plugins/fullscreen";
import Mobile from "xgplayer/es/plugins/mobile";
import PC from "xgplayer/es/plugins/pc";
import Play from "xgplayer/es/plugins/play";
import Progress from "xgplayer/es/plugins/progress";
import Start from "xgplayer/es/plugins/start";
import Time from "xgplayer/es/plugins/time";

I18N.use(ZH);

const VideoPlayer = ({
  url,
  autoplay,
  poster,
}: {
  url: string;
  autoplay?: boolean;
  poster?: string;
}) => {
  const autoplayRef = useRef(autoplay);
  const posterRef = useRef(poster);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  autoplayRef.current = autoplay;
  posterRef.current = poster;

  useEffect(() => {
    const playerContainer = playerContainerRef.current;
    if (!playerContainer) return;

    const player = new SimplePlayer({
      el: playerContainer,
      url,
      autoplay: autoplayRef.current,
      poster: posterRef.current,
      plugins: [Start, PC, Mobile, Progress, Play, Time, Error, Fullscreen],
    });

    return () => {
      player.pause();
      playerContainer
        .querySelectorAll<HTMLMediaElement>("video,audio")
        .forEach((media) => {
          media.pause();
          media.removeAttribute("src");
          media.load();
        });
      player.destroy();
      playerContainer.innerHTML = "";
    };
  }, [url]);

  return <div ref={playerContainerRef} />;
};

export default memo(VideoPlayer);
