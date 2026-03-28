import { t } from "i18next";
import { create } from "zustand";

import {
  BusinessAllowType,
  BusinessUserInfo,
  getAppConfig,
  getBusinessUserInfo,
} from "@/api/login";
import { getMomentsUnreadCount } from "@/api/moments";
import { IMSDK } from "@/layout/MainContentWrap";
import router from "@/routes";
import { feedbackToast } from "@/utils/common";
import { clearIMProfile, getLocale, setImageCache, setLocale } from "@/utils/storage";

import { useContactStore } from "./contact";
import { useConversationStore } from "./conversation";
import { AppConfig, AppSettings, UserStore } from "./type";

export const useUserStore = create<UserStore>()((set, get) => ({
  selfInfo: {} as BusinessUserInfo,
  appConfig: {} as AppConfig,
  appSettings: {
    locale: getLocale(),
    closeAction: "miniSize",
  },
  imageCache: {} as Record<string, string>,
  workMomentsUnreadCount: 0,
  getSelfInfoByReq: () => {
    IMSDK.getSelfUserInfo()
      .then(({ data }) => {
        set(() => ({ selfInfo: data as unknown as BusinessUserInfo }));
        getBusinessUserInfo([data.userID]).then(({ data: { users } }) =>
          set((state) => ({ selfInfo: { ...state.selfInfo, ...users[0] } })),
        );
      })
      .catch((error) => {
        feedbackToast({ error, msg: t("toast.getSelfInfoFailed") });
        get().userLogout();
      });
  },
  updateSelfInfo: (info: Partial<BusinessUserInfo>) => {
    set((state) => ({ selfInfo: { ...state.selfInfo, ...info } }));
  },
  getAppConfigByReq: async () => {
    let config = {} as AppConfig;
    try {
      const { data } = await getAppConfig();
      config = (data.config ?? {}) as AppConfig;
      if (!config.allowSendMsgNotFriend) {
        config.allowSendMsgNotFriend = BusinessAllowType.Allow;
      }
      if (!config.needInvitationCodeRegister) {
        config.needInvitationCodeRegister = BusinessAllowType.Allow;
      }
    } catch (error) {
      console.error("get app config err");
    }
    set((state) => ({ appConfig: { ...state.appConfig, ...config } }));
  },
  updateAppSettings: (settings: Partial<AppSettings>) => {
    if (settings.locale) {
      setLocale(settings.locale);
    }
    set((state) => ({ appSettings: { ...state.appSettings, ...settings } }));
  },
  userLogout: async (force?: boolean) => {
    console.log("🚪 [UserStore] 开始用户退出登录", {
      force,
      timestamp: new Date().toISOString()
    });

    if (!force) {
      console.log("🔄 [UserStore] 调用IMSDK.logout()");
      await IMSDK.logout();
    } else {
      console.log("⚠️ [UserStore] 强制退出，跳过IMSDK.logout()");
    }

    console.log("🗑️ [UserStore] 清除用户数据");
    clearIMProfile();
    set({ selfInfo: {} as BusinessUserInfo });
    useContactStore.getState().clearContactStore();
    useConversationStore.getState().clearConversationStore();
    window.electronAPI?.ipcInvoke("updateUnreadCount", 0);

    console.log("🔄 [UserStore] 跳转到登录页");
    router.navigate("/login");
    console.log("✅ [UserStore] 用户退出登录完成");
  },
  getWorkMomentsUnreadCount: async () => {
    try {
      const { data } = await getMomentsUnreadCount();
      set({ workMomentsUnreadCount: data.total });
    } catch (error) {
      console.error("get work moments unread count err");
    }
  },
  updateWorkMomentsUnreadCount: (count = 0) => {
    set({ workMomentsUnreadCount: count });
  },
  initImageCache: (cache: Record<string, string>) => {
    set(() => ({ imageCache: cache }));
  },
  addImageCache: (url: string, path: string) => {
    const newCache = { ...get().imageCache };
    newCache[url] = path;
    setImageCache(newCache);
    set(() => ({ imageCache: newCache }));
  },
  clearImageCache: () => {
    setImageCache({});
    set({ imageCache: {} });
  },
}));
