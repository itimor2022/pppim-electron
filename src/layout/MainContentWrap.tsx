import { getSDK } from "open-im-sdk-wasm";
import { AllowType } from "open-im-sdk-wasm";
import { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { useConversationStore, useUserStore } from "@/store";
import emitter from "@/utils/events";
import { checkNotificationPermission } from "@/utils/imCommon";
import { getImageCache, getIMToken, getIMUserID } from "@/utils/storage";

import { useAutoUpdate } from "./useAutoUpdate";

const isElectronProd = import.meta.env.MODE !== "development" && window.electronAPI;
const OPENIM_WASM_CACHE_KEY = "openim-wasm-cache";
const OPENIM_WASM_VERSION = "send-message-compat-20260416";

type WSSendMessage = ((...args: unknown[]) => unknown) & {
  __openIMSendMessageCompat?: boolean;
};

type WindowWithWasmSendMessage = Window & {
  sendMessage?: WSSendMessage;
  __openIMSendMessageCompatInstalled?: boolean;
};

const wrapWasmSendMessage = (sendMessage?: WSSendMessage) => {
  if (typeof sendMessage !== "function" || sendMessage.__openIMSendMessageCompat) {
    return sendMessage;
  }

  const compatibleSendMessage = ((...args: unknown[]) =>
    sendMessage(...(args.length === 6 ? [...args, false] : args))) as WSSendMessage;
  compatibleSendMessage.__openIMSendMessageCompat = true;
  return compatibleSendMessage;
};

const installSendMessageWasmCompat = () => {
  if (typeof window === "undefined") return;

  const wasmWindow = window as WindowWithWasmSendMessage;
  if (wasmWindow.__openIMSendMessageCompatInstalled) return;
  wasmWindow.__openIMSendMessageCompatInstalled = true;

  const descriptor = Object.getOwnPropertyDescriptor(wasmWindow, "sendMessage");
  let sendMessage = wrapWasmSendMessage(wasmWindow.sendMessage);

  if (descriptor && !descriptor.configurable) {
    wasmWindow.sendMessage = sendMessage;
    return;
  }

  Object.defineProperty(wasmWindow, "sendMessage", {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    get: () => sendMessage,
    set: (value?: WSSendMessage) => {
      sendMessage = wrapWasmSendMessage(value);
    },
  });
};

const clearOpenIMWasmCache = () => {
  if (typeof window !== "undefined" && "caches" in window) {
    void window.caches.delete(OPENIM_WASM_CACHE_KEY);
  }
};

const withResourceVersion = (path: string, version?: string) =>
  version ? `${path}?v=${version}` : path;

const getWasmPath = (fileName: string, version?: string) => {
  if (window.electronAPI) {
    // Electron 环境统一使用绝对路径
    return withResourceVersion(`/${fileName}`, version);
  }
  // Web 环境根据当前路径动态计算
  const path = window.location.pathname;
  const lastSlashIndex = path.lastIndexOf("/");
  const prefix = path.substring(0, lastSlashIndex + 1);
  return withResourceVersion(`${prefix}${fileName}`, version);
};

installSendMessageWasmCompat();
clearOpenIMWasmCache();

export const IMSDK = getSDK({
  coreWasmPath: getWasmPath("openIM.wasm", OPENIM_WASM_VERSION),
  sqlWasmPath: getWasmPath("sql-wasm.wasm"),
});

export const MainContentWrap = () => {
  const updateAppSettings = useUserStore((state) => state.updateAppSettings);
  const getAppConfigByReq = useUserStore((state) => state.getAppConfigByReq);
  const initImageCache = useUserStore((state) => state.initImageCache);

  const navigate = useNavigate();
  const location = useLocation();

  useAutoUpdate();

  useEffect(() => {
    const loginCheck = async () => {
      const IMToken = await getIMToken();
      const IMUserID = await getIMUserID();
      if (!IMToken || !IMUserID) {
        navigate("/login");
        return;
      }
    };

    loginCheck();
  }, [location.pathname]);

  useEffect(() => {
    window.userClick = (userID?: string, groupID?: string) => {
      if (!userID || userID === "AtAllTag") return;

      const currentGroupInfo = useConversationStore.getState().currentGroupInfo;

      if (groupID && currentGroupInfo?.lookMemberInfo === AllowType.NotAllowed) {
        return;
      }

      emitter.emit("OPEN_USER_CARD", {
        userID,
        groupID,
        isSelf: userID === useUserStore.getState().selfInfo.userID,
        notAdd:
          Boolean(groupID) &&
          currentGroupInfo?.applyMemberFriend === AllowType.NotAllowed,
      });
    };
  }, []);

  useEffect(() => {
    const initSettingStore = async () => {
      if (!window.electronAPI) return;
      updateAppSettings({
        closeAction:
          (await window.electronAPI?.ipcInvoke("getKeyStore", {
            key: "closeAction",
          })) || "miniSize",
      });
      const cache = await getImageCache();
      initImageCache(cache);
      window.electronAPI?.ipcInvoke("main-win-ready");
    };

    initSettingStore();
    getAppConfigByReq();
    checkNotificationPermission();
  }, []);

  return <Outlet />;
};
