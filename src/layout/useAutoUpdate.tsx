import { t } from "i18next";
import { Platform } from "open-im-sdk-wasm";
import { useEffect, useRef } from "react";

import { message } from "@/AntdGlobalComp";
import { APP_VERSION_CODE, CHECK_UPDATE_PREFIX } from "@/config";

interface ReleaseData {
  version: string;
  versionCode: number;
  releaseNotes: string;
  hotUpdate: boolean;
  forceUpdate: boolean;
  asarDownloadUrl: string;
  winDownloadUrl: string;
  winArmDownloadUrl: string;
  macDownloadUrl: string;
  macArmDownloadUrl: string;
  linuxDownloadUrl: string;
  linuxArmDownloadUrl: string;
}

const getUrlField = () => {
  const platform = window.electronAPI?.getPlatform();
  const arch = window.electronAPI?.getOsArch();
  if (platform === Platform.Windows) {
    return arch?.includes("arm") ? "winArmDownloadUrl" : "winDownloadUrl";
  }
  if (platform === Platform.MacOSX) {
    return arch?.includes("arm") ? "macArmDownloadUrl" : "macDownloadUrl";
  }
  return arch?.includes("arm") ? "linuxArmDownloadUrl" : "linuxDownloadUrl";
};

export function useAutoUpdate() {
  const isHotUpdate = useRef(false);
  let downloadUrl = "";
  useEffect(() => {
    if (!window.electronAPI || !CHECK_UPDATE_PREFIX) return;
    const updateDownloadSuccessHandler = (url: string, pkgPath: string) => {
      window.electronAPI
        ?.ipcInvoke("appUpdate", { isHot: isHotUpdate.current, pkgPath })
        .then(() =>
          message.success(
            isHotUpdate.current
              ? t("toast.applyUpdateSuccess")
              : t("toast.applyDownloadSuccess"),
          ),
        );
    };
    const unsubscribeUpdateDownloadSuccess = window.electronAPI?.subscribe(
      "updateDownloadSuccess",
      updateDownloadSuccessHandler,
    );
    setTimeout(checkUpdate, 10000);
    return () => {
      unsubscribeUpdateDownloadSuccess?.();
    };
  }, []);

  const checkUpdate = () => {
    fetch(`${CHECK_UPDATE_PREFIX}release.local`)
      .then((res) => res.json())
      .then((data: ReleaseData) => {
        const { version, versionCode, hotUpdate, asarDownloadUrl, releaseNotes } = data;
        if (APP_VERSION_CODE >= versionCode) return;
        isHotUpdate.current = hotUpdate;
        downloadUrl = hotUpdate ? asarDownloadUrl : data[getUrlField()];
        requestUpdate(version, releaseNotes);
      })
      .catch((err) => {
        console.log(err);
      });
  };

  const requestUpdate = (version: string, description: string) => {
    const options = {
      type: "info",
      title: t("toast.appUpdate"),
      message: t("toast.updateVersion", { version, description }),
      buttons: [t("yes"), t("no")],
    };
    window.electronAPI
      ?.ipcInvoke<number>("showMessageBox", options)
      .then((responseNumber) => {
        if (!responseNumber) {
          window.electronAPI?.ipcInvoke(
            "startDownload",
            `${downloadUrl}?is-update=true`,
          );
        }
      });
  };
}
