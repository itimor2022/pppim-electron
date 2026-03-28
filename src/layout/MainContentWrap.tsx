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

export const IMSDK = getSDK({
  coreWasmPath: "./openIM.wasm",
  sqlWasmPath: `${isElectronProd ? ".." : ""}/sql-wasm.wasm`,
});

export const MainContentWrap = () => {
  const updateAppSettings = useUserStore((state) => state.updateAppSettings);
  const getAppConfigByReq = useUserStore((state) => state.getAppConfigByReq);
  const initImageCache = useUserStore((state) => state.initImageCache);

  const navigate = useNavigate();
  const location = useLocation();

  useAutoUpdate();

  useEffect(() => {
    console.log("🌐 [MainContentWrap] 路由变化", {
      pathname: location.pathname,
      timestamp: new Date().toISOString()
    });

    const loginCheck = async () => {
      console.log("🔍 [MainContentWrap] 检查登录状态");
      const IMToken = await getIMToken();
      const IMUserID = await getIMUserID();

      console.log("🔍 [MainContentWrap] 获取到的登录信息", {
        hasIMToken: !!IMToken,
        hasIMUserID: !!IMUserID,
        IMUserID,
        pathname: location.pathname
      });

      if (!IMToken || !IMUserID) {
        console.log("❌ [MainContentWrap] 缺少登录信息，跳转到登录页");
        navigate("/login");
        return;
      } else {
        console.log("✅ [MainContentWrap] 登录信息完整");
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
