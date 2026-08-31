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

const SDK_LOGOUT_TIMEOUT_MS = 3000;
const IMAGE_CACHE_BATCH_DELAY_MS = 50;

let logoutTask: Promise<void> | undefined;
let imageCacheFlushTimer: ReturnType<typeof setTimeout> | undefined;
let imageCachePersistenceRunning = false;
let pendingImageCachePersistence: Record<string, string> | undefined;
const pendingImageCacheAdditions = new Map<string, string>();

const persistLatestImageCache = (cache: Record<string, string>) => {
  pendingImageCachePersistence = cache;
  if (imageCachePersistenceRunning) return;

  imageCachePersistenceRunning = true;
  void (async () => {
    while (pendingImageCachePersistence) {
      const latestCache = pendingImageCachePersistence;
      pendingImageCachePersistence = undefined;
      try {
        await setImageCache(latestCache);
      } catch (error) {
        console.error("persist image cache failed", error);
      }
    }
    imageCachePersistenceRunning = false;
  })();
};

const flushPendingImageCacheAdditions = () => {
  imageCacheFlushTimer = undefined;
  if (!pendingImageCacheAdditions.size) return;

  const additions = Object.fromEntries(pendingImageCacheAdditions);
  pendingImageCacheAdditions.clear();
  useUserStore.setState((state) => {
    const imageCache = { ...state.imageCache, ...additions };
    persistLatestImageCache(imageCache);
    return { imageCache };
  });
};

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
      config = data.config ?? {};
      if (!config.allowSendMsgNotFriend) {
        config.allowSendMsgNotFriend = BusinessAllowType.Allow;
      }
      if (!config.needInvitationCodeRegister) {
        config.needInvitationCodeRegister = BusinessAllowType.Allow;
      }
      if (config.showMessageReadStatus === undefined) {
        config.showMessageReadStatus = 1;
      }
      if (config.showOnlinePlatform === undefined) {
        config.showOnlinePlatform = 0;
      }
      if (config.showUserOnlineStatus === undefined) {
        config.showUserOnlineStatus = 1;
      }
      if (config.showGroupAllMembers === undefined) {
        config.showGroupAllMembers = 1;
      }
      if (!Number(config.revokeMessageDurationMinutes)) {
        config.revokeMessageDurationMinutes = 5;
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
  userLogout: (force?: boolean) => {
    if (logoutTask) return logoutTask;

    logoutTask = (async () => {
      let logoutTimeout: ReturnType<typeof setTimeout> | undefined;
      if (!force) {
        try {
          await Promise.race([
            IMSDK.logout(),
            new Promise<never>((_, reject) => {
              logoutTimeout = setTimeout(
                () => reject(new Error("SDK logout timed out")),
                SDK_LOGOUT_TIMEOUT_MS,
              );
            }),
          ]);
        } catch (error) {
          console.error("sdk logout failed", error);
        } finally {
          if (logoutTimeout) clearTimeout(logoutTimeout);
        }
      }
      await clearIMProfile();
      set({ selfInfo: {} as BusinessUserInfo });
      useContactStore.getState().clearContactStore();
      useConversationStore.getState().clearConversationStore();
      window.electronAPI?.ipcInvoke("updateUnreadCount", 0);
      router.navigate("/login", { replace: true });
    })().finally(() => {
      logoutTask = undefined;
    });
    return logoutTask;
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
    if (
      pendingImageCacheAdditions.get(url) === path ||
      (!pendingImageCacheAdditions.has(url) && get().imageCache[url] === path)
    ) {
      return;
    }
    pendingImageCacheAdditions.set(url, path);
    if (!imageCacheFlushTimer) {
      imageCacheFlushTimer = setTimeout(
        flushPendingImageCacheAdditions,
        IMAGE_CACHE_BATCH_DELAY_MS,
      );
    }
  },
  clearImageCache: () => {
    if (imageCacheFlushTimer) {
      clearTimeout(imageCacheFlushTimer);
      imageCacheFlushTimer = undefined;
    }
    pendingImageCacheAdditions.clear();
    persistLatestImageCache({});
    set({ imageCache: {} });
  },
}));
