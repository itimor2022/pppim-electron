import { Image, ImageProps } from "antd";
import { useEffect, useState } from "react";

import { useUserStore } from "@/store";
import { downloadFile } from "@/utils/common";

const CacheImage = (props: ImageProps) => {
  const cachePath = useUserStore((state) =>
    props.src ? state.imageCache[props.src] : undefined,
  );
  const [sourceURL, setSourceURL] = useState(props.src);

  useEffect(() => {
    if (!window.electronAPI || props.src?.match(/^blob:/)) {
      setSourceURL(props.src);
      return;
    }
    if (!props.src?.match(/^https?:\/\//) && !props.src?.match(/^file:\/\//)) {
      setSourceURL(props.src ? `file://${props.src}` : props.src);
      return;
    }
    if (cachePath && window.electronAPI.fileExists(cachePath)) {
      setSourceURL(`file://${cachePath}`);
      return;
    }

    setSourceURL(props.src);
    if (props.src?.match(/^https?:\/\//)) {
      void downloadFile(props.src, {
        isThumb: true,
        saveType: "image",
        randomName: true,
      });
    }
  }, [cachePath, props.src]);

  return <Image {...props} src={sourceURL} />;
};

export default CacheImage;
