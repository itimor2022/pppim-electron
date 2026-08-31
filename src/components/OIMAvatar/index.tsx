import { Avatar as AntdAvatar, AvatarProps } from "antd";
import clsx from "clsx";
import * as React from "react";

import default_group from "@/assets/images/contact/my_groups.png";
import { useUserStore } from "@/store";
import { avatarList, getDefaultAvatar } from "@/utils/avatar";
import { downloadFile } from "@/utils/common";

const default_avatars = avatarList.map((item) => item.name);

interface IOIMAvatarProps extends AvatarProps {
  text?: string;
  color?: string;
  bgColor?: string;
  isgroup?: boolean;
  isnotification?: boolean;
  size?: number;
}

const OIMAvatar = React.forwardRef<HTMLSpanElement, IOIMAvatarProps>((props, ref) => {
  const {
    src,
    text,
    size = 42,
    color = "#fff",
    bgColor = "#2074de",
    isgroup = false,
    className,
    style,
    ...avatarProps
  } = props;
  delete avatarProps.isnotification;
  const [errorHolder, setErrorHolder] = React.useState<string>();
  const sourceURL = typeof src === "string" ? src : undefined;
  const cachePath = useUserStore((state) =>
    sourceURL ? state.imageCache[sourceURL] : undefined,
  );
  const [avatarSource, setAvatarSource] = React.useState<AvatarProps["src"]>(
    src || (isgroup ? default_group : undefined),
  );

  React.useEffect(() => {
    if (!sourceURL) {
      setAvatarSource(src || (isgroup ? default_group : undefined));
      return;
    }
    if (default_avatars.includes(sourceURL)) {
      setAvatarSource(getDefaultAvatar(sourceURL));
      return;
    }
    if (!window.electronAPI) {
      setAvatarSource(src);
      return;
    }
    if (cachePath && window.electronAPI.fileExists(cachePath)) {
      setAvatarSource(`file://${cachePath}`);
      return;
    }

    setAvatarSource(src);
    if (/^https?:\/\//.test(sourceURL)) {
      void downloadFile(sourceURL, {
        isThumb: true,
        saveType: "avatar",
      });
    }
  }, [cachePath, isgroup, sourceURL, src]);

  React.useEffect(() => {
    if (!isgroup) {
      setErrorHolder(undefined);
    }
  }, [isgroup]);

  const errorHandler = () => {
    if (isgroup) {
      setErrorHolder(default_group);
    }
    return true;
  };

  return (
    <AntdAvatar
      ref={ref}
      shape="square"
      {...avatarProps}
      style={{
        backgroundColor: bgColor,
        minWidth: `${size}px`,
        minHeight: `${size}px`,
        lineHeight: `${size - 2}px`,
        color,
        ...style,
      }}
      className={clsx(
        {
          "cursor-pointer": Boolean(avatarProps.onClick),
        },
        className,
      )}
      src={errorHolder ?? avatarSource}
      onError={errorHandler}
    >
      {text}
    </AntdAvatar>
  );
});

OIMAvatar.displayName = "OIMAvatar";

export default OIMAvatar;
