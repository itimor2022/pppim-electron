import { clipboard, globalShortcut, ipcMain, nativeImage } from "electron";
import { t } from "i18next";
import Screenshots from "electron-screenshots";
import { hideWindow, isShowMainWindow, sendEvent, showWindow, toggleWindowVisible } from "./windowManage";
import { IpcMainToRender, IpcRenderToMain } from "../constants";
import { isWin } from "../utils";

function uint8ArrayToBase64(bytes: Uint8Array) {
  var binary = "";
  var len = bytes.byteLength;

  for (var i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

const checkWindowVisible = () => {
  if(isWin){
    toggleWindowVisible(true)
    return
  }
  if(!isShowMainWindow()) showWindow()
}

export default () => {
  const screenshots = new Screenshots({
    singleWindow: true,
    lang: {
      magnifier_position_label: t("system.magnifier_position_label"),
    },
  });
  screenshots.on("windowCreated", ($win) => {
    $win.on("focus", () => {
      globalShortcut.register("esc", () => {
        if ($win?.isFocused()) {
          screenshots.endCapture();
        }
      });
    });

    $win.on("blur", () => {
      globalShortcut.unregister("esc");
    });
  });

  screenshots.on("cancel", () => {
    checkWindowVisible();
    sendEvent(
      IpcMainToRender.captureResponse
    )
  });

  screenshots.on("ok", (_, array) => {
    const nImage = nativeImage.createFromBuffer(Buffer.from(array));
    clipboard.writeImage(nImage);
    checkWindowVisible();
    setTimeout(
      () =>
        sendEvent(
          IpcMainToRender.captureResponse,
          `data:image/png;base64,${uint8ArrayToBase64(array)}`,
        ),
      50,
    );
  });

  ipcMain.handle(IpcRenderToMain.capture, (_, hidden) => {
    global.hiddenWindow = hidden;
    if (hidden) {
      if(isWin){
        toggleWindowVisible(false)
      }else {
        hideWindow();
      }
    }
    screenshots.startCapture();
  });
};
