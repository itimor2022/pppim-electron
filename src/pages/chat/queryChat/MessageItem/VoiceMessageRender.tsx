import clsx from "clsx";
import { FC, useCallback, useEffect, useRef, useState } from "react";

import VoiceIcon from "@/svg/VoiceIcon";
import { feedbackToast } from "@/utils/common";

import { IMessageItemProps } from ".";
import styles from "./message-item.module.scss";

const PAUSE_VOICE_MESSAGE_EVENT = "pauseVoiceMessage";

const VoiceMessageRender: FC<IMessageItemProps> = ({ message, isSender, disabled }) => {
  const audioEl = useRef<HTMLAudioElement>(new Audio());
  const [isPlaying, setIsPlaying] = useState(false);

  const pauseAudio = useCallback(() => {
    const audio = audioEl.current;
    if (!audio.paused) {
      audio.pause();
    }
    setIsPlaying(false);
  }, []);

  useEffect(() => {
    const audio = audioEl.current;
    audio.src = message.soundElem.sourceUrl;
    audio.onended = () => {
      setIsPlaying(false);
    };
    audio.onpause = () => {
      setIsPlaying(false);
    };
    audio.onplay = () => {
      setIsPlaying(true);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        pauseAudio();
      }
    };

    const unsubscribe = window.electronAPI?.subscribe(
      PAUSE_VOICE_MESSAGE_EVENT,
      pauseAudio,
    );
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      unsubscribe?.();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.onended = null;
      audio.onpause = null;
      audio.onplay = null;
    };
  }, [message.soundElem.sourceUrl, pauseAudio]);

  const playAudio = () => {
    if (isPlaying) {
      audioEl.current?.pause();
      setIsPlaying(false);
    } else {
      audioEl.current
        ?.play()
        .catch((error: unknown) => feedbackToast({ error, msg: "play audio failed" }));
    }
  };

  return (
    <div
      className={clsx(
        styles.bubble,
        "flex cursor-pointer items-center !py-2",
        !isSender && "flex-row-reverse",
        disabled && "justify-end",
      )}
      onClick={playAudio}
    >
      <VoiceIcon
        style={{ transform: isSender ? "rotateY(180deg)" : "none" }}
        playing={isPlaying}
      />
      <span
        className={isSender ? "mr-1" : "ml-1"}
      >{`${message.soundElem.duration} ‘’`}</span>
    </div>
  );
};

export default VoiceMessageRender;
