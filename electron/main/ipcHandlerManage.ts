import fs from "fs";
import {
  BrowserWindow,
  Menu,
  app,
  desktopCapturer,
  dialog,
  ipcMain,
  shell,
} from "electron";
import { join } from "path";
import zipUtil from "adm-zip";
import {
  clearCache,
  closeWindow,
  createChildWindow,
  getIMSDKServiceWebContents,
  getWebContents,
  hotReload,
  minimize,
  showWindow,
  splashEnd,
  taskFlicker,
  updateMaximize,
} from "./windowManage";
import { t } from "i18next";
import { IpcMainToRender, IpcRenderToMain } from "../constants";
import { getStore } from "./storeManage";
import { flicker, setTrayTitle } from "./trayManage";
import { setUserCachePath } from "./appManage";
import { asarHotUpdate } from "./assetsManage";
import { changeLanguage } from "../i18n";

const childWindowMap: { [key: string]: number } = {};

const store = getStore();

const OPENIM_SDK_READY_TIMEOUT_MS = 15_000;
const OPENIM_SDK_CALL_TIMEOUT_MS = 90_000;

type OpenIMSDKResponse = { ok: true; data: unknown } | { ok: false; error: unknown };

type OpenIMSDKReadyWaiter = {
  resolve: (webContents: Electron.WebContents) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const openIMSDKReadyWaiters = new Set<OpenIMSDKReadyWaiter>();
const pendingOpenIMSDKCalls = new Map<
  number,
  {
    resolve: (response: OpenIMSDKResponse) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();
let openIMSDKServiceReadyID: number | undefined;
let openIMSDKRequestID = 0;

const serializeIPCError = (error: unknown) => {
  if (!error || typeof error !== "object") return error;
  const serialized = Object.fromEntries(Object.entries(error));
  if (error instanceof Error) {
    serialized.name = error.name;
    serialized.message = error.message;
    serialized.stack = error.stack;
  }
  return serialized;
};

const waitForOpenIMSDKService = () => {
  const serviceWebContents = getIMSDKServiceWebContents();
  if (
    serviceWebContents &&
    !serviceWebContents.isDestroyed() &&
    serviceWebContents.id === openIMSDKServiceReadyID
  ) {
    return Promise.resolve(serviceWebContents);
  }

  return new Promise<Electron.WebContents>((resolve, reject) => {
    const waiter: OpenIMSDKReadyWaiter = {
      resolve,
      reject,
      timeout: setTimeout(() => {
        openIMSDKReadyWaiters.delete(waiter);
        reject(new Error("OpenIM SDK service startup timed out"));
      }, OPENIM_SDK_READY_TIMEOUT_MS),
    };
    openIMSDKReadyWaiters.add(waiter);
  });
};

export const clearChildWindows = () => {
  for (const key in childWindowMap) {
    const childWindow = BrowserWindow.getAllWindows().find(
      (win) => win.id === childWindowMap[key],
    );
    if (childWindow && !childWindow.isDestroyed()) {
      childWindow.close();
    }
  }
};

export const openChildWindowHandle = (props) => {
  const { arg, search, key, options } = props;
  if (!childWindowMap[key]) {
    const childWindow = createChildWindow(arg, options, search);
    childWindowMap[key] = childWindow.id;
    return;
  }

  const childWindow = BrowserWindow.getAllWindows().find(
    (win) => win.id === childWindowMap[key],
  );
  if (childWindow) {
    if (childWindow.isMinimized()) {
      childWindow.restore();
    }
    if (childWindow.isVisible()) {
      childWindow.focus();
    } else {
      childWindow.show();
    }
  }
};

export const setIpcMainListener = () => {
  ipcMain.handle("openim-sdk-service-ready", (event) => {
    const serviceWebContents = getIMSDKServiceWebContents();
    if (!serviceWebContents || serviceWebContents.id !== event.sender.id) return false;

    openIMSDKServiceReadyID = event.sender.id;
    openIMSDKReadyWaiters.forEach((waiter) => {
      clearTimeout(waiter.timeout);
      waiter.resolve(serviceWebContents);
    });
    openIMSDKReadyWaiters.clear();
    return true;
  });

  ipcMain.handle("openim-sdk-init", async (_event, config) => {
    const serviceWebContents = await waitForOpenIMSDKService();
    serviceWebContents.send("openim-sdk-service-command", {
      type: "init",
      config,
    });
    return true;
  });

  ipcMain.handle("openim-sdk-call", async (_event, request) => {
    try {
      const serviceWebContents = await waitForOpenIMSDKService();
      const requestID = ++openIMSDKRequestID;
      return await new Promise<OpenIMSDKResponse>((resolve) => {
        const timeout = setTimeout(() => {
          pendingOpenIMSDKCalls.delete(requestID);
          resolve({
            ok: false,
            error: {
              name: "TimeoutError",
              message: `OpenIM SDK call timed out: ${request?.method ?? "unknown"}`,
            },
          });
        }, OPENIM_SDK_CALL_TIMEOUT_MS);
        pendingOpenIMSDKCalls.set(requestID, { resolve, timeout });
        serviceWebContents.send("openim-sdk-service-command", {
          type: "call",
          requestID,
          method: request?.method,
          args: request?.args ?? [],
        });
      });
    } catch (error) {
      return { ok: false, error: serializeIPCError(error) } as OpenIMSDKResponse;
    }
  });

  ipcMain.handle("openim-sdk-service-result", (event, response) => {
    if (event.sender.id !== openIMSDKServiceReadyID) return false;
    const pendingCall = pendingOpenIMSDKCalls.get(response?.requestID);
    if (!pendingCall) return false;

    pendingOpenIMSDKCalls.delete(response.requestID);
    clearTimeout(pendingCall.timeout);
    if (Object.prototype.hasOwnProperty.call(response, "error")) {
      pendingCall.resolve({ ok: false, error: response.error });
    } else {
      pendingCall.resolve({ ok: true, data: response.data });
    }
    return true;
  });

  ipcMain.handle("openim-sdk-service-event", (event, payload) => {
    if (event.sender.id !== openIMSDKServiceReadyID) return false;
    BrowserWindow.getAllWindows().forEach((window) => {
      if (
        window.isDestroyed() ||
        window.webContents.isDestroyed() ||
        window.webContents.id === event.sender.id
      ) {
        return;
      }
      window.webContents.send("openim-sdk-event", payload);
    });
    return true;
  });

  ipcMain.handle(IpcRenderToMain.clearSession, () => {
    clearCache();
  });

  // window manage
  ipcMain.handle("changeLanguage", (_, locale) => {
    store.set("language", locale);
    changeLanguage(locale).then(() => {
      app.relaunch();
      app.exit(0);
    });
  });
  ipcMain.handle("main-win-ready", () => {
    splashEnd();
  });
  ipcMain.handle(IpcRenderToMain.showMainWindow, () => {
    showWindow();
  });
  ipcMain.handle(IpcRenderToMain.openChildWindow, (_, props) => {
    openChildWindowHandle(props);
  });
  ipcMain.handle(IpcRenderToMain.minimizeWindow, (_, key) => {
    if (!key) {
      minimize();
      return;
    }
    const childWindow = BrowserWindow.getAllWindows().find(
      (win) => win.id === childWindowMap[key],
    );
    if (childWindow) {
      childWindow.minimize();
    }
  });
  ipcMain.handle(IpcRenderToMain.maxmizeWindow, (_, key) => {
    if (!key) {
      updateMaximize();
      return;
    }
    const childWindow = BrowserWindow.getAllWindows().find(
      (win) => win.id === childWindowMap[key],
    );
    if (childWindow) {
      if (childWindow.isMaximized()) {
        childWindow.unmaximize();
      } else {
        childWindow.maximize();
      }
    }
  });
  ipcMain.handle(IpcRenderToMain.closeWindow, (_, key) => {
    if (!key) {
      closeWindow();
      return;
    }
    const childWindow = BrowserWindow.getAllWindows().find(
      (win) => win.id === childWindowMap[key],
    );
    if (childWindow.isDestroyed()) {
      delete childWindowMap[key];
    }
    if (childWindow && !childWindow.isDestroyed()) {
      childWindow.close();
      delete childWindowMap[key];
    }
  });
  ipcMain.handle(IpcRenderToMain.showMessageBox, (_, options) => {
    return dialog
      .showMessageBox(BrowserWindow.getFocusedWindow(), options)
      .then((res) => res.response);
  });

  // data transfer
  ipcMain.handle(IpcRenderToMain.transferChooseModalData, (_, { key, data }) => {
    let targetWebContents: Electron.WebContents;
    if (!key) {
      targetWebContents = getWebContents();
    } else {
      targetWebContents = BrowserWindow.getAllWindows().find(
        (win) => win.id === childWindowMap[key],
      ).webContents;
    }
    if (targetWebContents) {
      targetWebContents.send(IpcMainToRender.transferChooseModalData, data);
    }
  });
  ipcMain.handle(IpcRenderToMain.getContactStoreData, (_, { key }) => {
    const targetWebContents = getWebContents();
    targetWebContents.send(IpcMainToRender.getContactStoreData, key);
  });
  ipcMain.handle(IpcRenderToMain.transferContactStoreData, (_, { key, data }) => {
    const targetWebContents = BrowserWindow.getAllWindows().find(
      (win) => win.id === childWindowMap[key],
    )?.webContents;
    if (targetWebContents) {
      targetWebContents.send(IpcMainToRender.transferContactStoreData, data);
    }
  });
  ipcMain.handle(IpcRenderToMain.setKeyStore, (_, { key, data }) => {
    store.set(key, data);
  });
  ipcMain.handle(IpcRenderToMain.getKeyStore, (_, { key }) => {
    return store.get(key);
  });
  ipcMain.on(IpcRenderToMain.getKeyStoreSync, (e, { key }) => {
    e.returnValue = store.get(key);
  });
  ipcMain.handle(IpcRenderToMain.showInputContextMenu, () => {
    const menu = Menu.buildFromTemplate([
      {
        label: t("system.copy"),
        type: "normal",
        role: "copy",
        accelerator: "CommandOrControl+c",
      },
      {
        label: t("system.paste"),
        type: "normal",
        role: "paste",
        accelerator: "CommandOrControl+v",
      },
      {
        label: t("system.selectAll"),
        type: "normal",
        role: "selectAll",
        accelerator: "CommandOrControl+a",
      },
    ]);
    menu.popup({
      window: BrowserWindow.getFocusedWindow()!,
    });
  });
  ipcMain.handle(IpcRenderToMain.updateUnreadCount, (_, count) => {
    app.setBadgeCount(count);
    setTrayTitle(count);
    flicker(count > 0);
    if (count > 0) {
      taskFlicker();
    }
  });
  ipcMain.handle(IpcRenderToMain.appUpdate, async (_, { pkgPath, isHot }) => {
    if (isHot) {
      const flag = await asarHotUpdate(pkgPath);
      if (flag) {
        fs.unlink(pkgPath, () => {});
        setTimeout(() => {
          app.relaunch();
          app.exit(0);
        }, 1000);
      }
      return flag;
    }
    shell.openPath(pkgPath);
    return true;
  });
  ipcMain.handle(IpcRenderToMain.setUserCachePath, (_, userID) => {
    setUserCachePath(userID);
  });
  ipcMain.on(IpcRenderToMain.getDataPath, (e, key: string) => {
    switch (key) {
      case "public":
        e.returnValue = global.pathConfig.publicPath;
        break;
      case "fileCache":
        e.returnValue = global.pathConfig.fileCachePath;
        break;
      case "sentFileCache":
        e.returnValue = global.pathConfig.sentFileCachePath;
        break;
      case "extraResources":
        e.returnValue = global.pathConfig.extraResourcesPath;
      default:
        e.returnValue = global.pathConfig.publicPath;
        break;
    }
  });
  ipcMain.handle(IpcRenderToMain.dragFile, (e, filePath) => {
    e.sender.startDrag({
      file: filePath,
      icon: global.pathConfig.trayIcon,
    });
  });
  ipcMain.handle(IpcRenderToMain.showLogsInFinder, () => {
    shell.openPath(global.pathConfig.logsPath);
  });
  ipcMain.handle(IpcRenderToMain.prepareUploadLogs, async () => {
    const logsPath = global.pathConfig.logsPath;
    const zip = new zipUtil();
    zip.addLocalFolder(logsPath);
    let date = new Date();
    let dateStr =
      date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate();
    const zipPath = join(global.pathConfig.logsPath, `${dateStr}electronlog.zip`);
    await zip.writeZipPromise(zipPath);
    return zipPath;
  });
  ipcMain.handle(IpcRenderToMain.hotRelaunch, hotReload);

  // screen share
  ipcMain.handle(IpcRenderToMain.getScreenSource, async () => {
    const sources = await desktopCapturer.getSources({ types: ["screen"] });
    return sources[0]?.id;
  });
};
