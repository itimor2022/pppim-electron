import { AllowType } from "open-im-sdk-wasm";
import { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { useConversationStore, useUserStore } from "@/store";
import emitter from "@/utils/events";
import { checkNotificationPermission } from "@/utils/imCommon";
import { createIMSDKWorkerBridge } from "@/utils/imSdkWorkerBridge";
import { getImageCache, getIMToken, getIMUserID } from "@/utils/storage";

import { useAutoUpdate } from "./useAutoUpdate";

const OPENIM_WASM_CACHE_KEY = "openim-wasm-cache";
const OPENIM_WASM_VERSION = "send-message-args-20260428";
const GROUP_MEMBER_REQUEST_MAX_CONCURRENCY = 4;
const GROUP_MEMBER_REQUEST_TIMEOUT_MS = 20_000;

const installGroupMemberRequestScheduler = () => {
  const schedulerWindow = window as typeof window & {
    __openimGroupMemberRequestSchedulerInstalled?: boolean;
  };
  if (schedulerWindow.__openimGroupMemberRequestSchedulerInstalled) return;
  schedulerWindow.__openimGroupMemberRequestSchedulerInstalled = true;

  const rawFetch = window.fetch.bind(window);
  const pendingRequests: Array<{
    input: RequestInfo | URL;
    init?: RequestInit;
    signal?: AbortSignal;
    abortHandler?: () => void;
    resolve: (response: Response) => void;
    reject: (reason?: unknown) => void;
  }> = [];
  let activeRequests = 0;

  const runPendingRequests = () => {
    while (
      activeRequests < GROUP_MEMBER_REQUEST_MAX_CONCURRENCY &&
      pendingRequests.length
    ) {
      const request = pendingRequests.shift();
      if (!request) return;
      if (request.signal?.aborted) {
        if (request.abortHandler) {
          request.signal.removeEventListener("abort", request.abortHandler);
        }
        request.reject(new DOMException("The operation was aborted.", "AbortError"));
        continue;
      }
      if (request.abortHandler) {
        request.signal?.removeEventListener("abort", request.abortHandler);
      }
      activeRequests += 1;
      const controller = new AbortController();
      let didTimeout = false;
      const abortActiveRequest = () => controller.abort(request.signal?.reason);
      request.signal?.addEventListener("abort", abortActiveRequest, { once: true });
      const timeout = setTimeout(() => {
        didTimeout = true;
        controller.abort();
      }, GROUP_MEMBER_REQUEST_TIMEOUT_MS);
      rawFetch(request.input, {
        ...request.init,
        signal: controller.signal,
      })
        .then(request.resolve)
        .catch((error) => {
          if (didTimeout) {
            request.reject(
              new DOMException("Group member request timed out.", "TimeoutError"),
            );
            return;
          }
          request.reject(error);
        })
        .finally(() => {
          clearTimeout(timeout);
          request.signal?.removeEventListener("abort", abortActiveRequest);
          activeRequests -= 1;
          runPendingRequests();
        });
    }
  };

  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const requestURL =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!/\/group\/get_group_member_list(?:$|[?#])/.test(requestURL)) {
      return rawFetch(input, init);
    }
    return new Promise<Response>((resolve, reject) => {
      const signal =
        init?.signal ?? (input instanceof Request ? input.signal : undefined);
      if (signal?.aborted) {
        reject(new DOMException("The operation was aborted.", "AbortError"));
        return;
      }
      const request = { input, init, signal, resolve, reject } as {
        input: RequestInfo | URL;
        init?: RequestInit;
        signal?: AbortSignal;
        abortHandler?: () => void;
        resolve: (response: Response) => void;
        reject: (reason?: unknown) => void;
      };
      request.abortHandler = () => {
        const requestIndex = pendingRequests.indexOf(request);
        if (requestIndex < 0) return;
        pendingRequests.splice(requestIndex, 1);
        reject(new DOMException("The operation was aborted.", "AbortError"));
      };
      signal?.addEventListener("abort", request.abortHandler, { once: true });
      pendingRequests.push(request);
      runPendingRequests();
    });
  }) as typeof window.fetch;
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

clearOpenIMWasmCache();
installGroupMemberRequestScheduler();

export const IMSDK = createIMSDKWorkerBridge({
  coreWasmPath: getWasmPath("openIM.wasm", OPENIM_WASM_VERSION),
  sqlWasmPath: getWasmPath("sql-wasm.wasm"),
  wasmExecPath: getWasmPath("wasm_exec.js"),
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
      try {
        updateAppSettings({
          closeAction:
            (await window.electronAPI.ipcInvoke("getKeyStore", {
              key: "closeAction",
            })) || "miniSize",
        });
        const cache = await getImageCache();
        initImageCache(cache);
      } catch (error) {
        console.error("initialize app settings failed", error);
      } finally {
        window.electronAPI.ipcInvoke("main-win-ready");
      }
    };

    initSettingStore();
    getAppConfigByReq();
    checkNotificationPermission();
  }, []);

  return <Outlet />;
};
