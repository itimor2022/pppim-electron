import { useLatest, useThrottleFn } from "ahooks";
import { t } from "i18next";
import { CbEvents } from "open-im-sdk-wasm";
import {
  GroupStatus,
  LogLevel,
  MessageReceiveOptType,
  MessageType,
  SessionType,
} from "open-im-sdk-wasm";
import {
  BlackUserItem,
  ConversationItem,
  FriendApplicationItem,
  FriendUserItem,
  GroupApplicationItem,
  GroupItem,
  GroupMemberItem,
  RevokedInfo,
  SelfUserInfo,
  WSEvent,
  WsResponse,
} from "open-im-sdk-wasm/lib/types/entity";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { message as antdMessage } from "@/AntdGlobalComp";
import { BusinessAllowType } from "@/api/login";
import messageRing from "@/assets/audio/newMsg.mp3";
import { getApiUrl, getWsUrl } from "@/config";
import { SystemMessageTypes } from "@/constants";
import {
  ExMessageItem,
  useConversationStore,
  useMessageStore,
  useUserStore,
} from "@/store";
import { useContactStore } from "@/store/contact";
import { feedbackToast, finishAutoDownload } from "@/utils/common";
import emitter from "@/utils/events";
import { createNotification, initStore, isGroupSession } from "@/utils/imCommon";
import { clearIMProfile, getIMToken, getIMUserID } from "@/utils/storage";

import { IMSDK } from "./MainContentWrap";

const CONVERSATION_EVENT_BATCH_MS = 250;
const SYNC_CONVERSATION_EVENT_BATCH_MS = 1_000;
const CONVERSATION_EVENT_CHUNK_SIZE = 200;
const CONVERSATION_EVENT_CHUNK_BUDGET_MS = 6;
const CONVERSATION_FLUSH_IDLE_TIMEOUT_MS = 500;
const SYNC_CURRENT_MESSAGE_BATCH_MS = 500;

type PendingConversationEventBatch = {
  data: ConversationItem[];
  index: number;
};

const preserveNewerConversationLatest = (
  current: ConversationItem,
  incoming: ConversationItem,
) => {
  let preserveCurrentLatest = current.latestMsgSendTime > incoming.latestMsgSendTime;
  if (current.latestMsgSendTime === incoming.latestMsgSendTime) {
    try {
      const currentMessage = JSON.parse(current.latestMsg) as ExMessageItem;
      const incomingMessage = JSON.parse(incoming.latestMsg) as ExMessageItem;
      preserveCurrentLatest =
        currentMessage.clientMsgID !== incomingMessage.clientMsgID &&
        currentMessage.seq > 0 &&
        incomingMessage.seq > 0 &&
        currentMessage.seq > incomingMessage.seq;
    } catch {
      preserveCurrentLatest = false;
    }
  }
  if (!preserveCurrentLatest) return incoming;
  return {
    ...incoming,
    latestMsg: current.latestMsg,
    latestMsgSendTime: current.latestMsgSendTime,
  };
};

const normalizeNewMessages = (data: ExMessageItem | ExMessageItem[]): ExMessageItem[] =>
  Array.isArray(data) ? data : data ? [data] : [];

export function useGlobalEvent() {
  const navigate = useNavigate();
  const [connectState, setConnectState] = useState({
    isSyncing: false,
    isLogining: false,
    isConnecting: false,
  });
  const latestConnectState = useLatest(connectState);
  const initialSyncFinished = useRef(false);
  const initialSyncIndicatorDismissed = useRef(false);
  const syncRetryCount = useRef(0);
  const syncRetryTimer = useRef<ReturnType<typeof setTimeout>>();
  const syncFallbackTimer = useRef<ReturnType<typeof setTimeout>>();
  const backgroundSyncing = useRef(false);
  const pendingConversationChanges = useRef(new Map<string, ConversationItem>());
  const conversationChangeFlushTimer = useRef<ReturnType<typeof setTimeout>>();
  const conversationChangeIdleCallback = useRef<number>();
  const pendingConversationEventBatches = useRef<PendingConversationEventBatch[]>([]);
  const conversationEventProcessTimer = useRef<ReturnType<typeof setTimeout>>();
  const pendingConversationTerminalHandler = useRef<() => void>();
  const pendingSyncCurrentMessages = useRef(new Map<string, ExMessageItem>());
  const syncCurrentMessageFlushTimer = useRef<ReturnType<typeof setTimeout>>();
  const pendingAddedFriends = useRef(new Map<string, FriendUserItem>());
  const friendAddedFlushTimer = useRef<ReturnType<typeof setTimeout>>();
  // user
  const updateSelfInfo = useUserStore((state) => state.updateSelfInfo);
  const getWorkMomentsUnreadCount = useUserStore(
    (state) => state.getWorkMomentsUnreadCount,
  );
  const userLogout = useUserStore((state) => state.userLogout);
  const addImageCache = useUserStore((state) => state.addImageCache);
  // conversation
  const updateConversationList = useConversationStore(
    (state) => state.updateConversationList,
  );
  const updateCurrentConversation = useConversationStore(
    (state) => state.updateCurrentConversation,
  );
  const updateUnReadCount = useConversationStore((state) => state.updateUnReadCount);
  const updateCurrentGroupInfo = useConversationStore(
    (state) => state.updateCurrentGroupInfo,
  );
  const getCurrentGroupInfoByReq = useConversationStore(
    (state) => state.getCurrentGroupInfoByReq,
  );
  const getCurrentMemberInGroupByReq = useConversationStore(
    (state) => state.getCurrentMemberInGroupByReq,
  );
  const tryUpdateCurrentMemberInGroup = useConversationStore(
    (state) => state.tryUpdateCurrentMemberInGroup,
  );
  // message
  const pushNewMessage = useMessageStore((state) => state.pushNewMessage);
  const pushNewMessages = useMessageStore((state) => state.pushNewMessages);
  const updateOneMessage = useMessageStore((state) => state.updateOneMessage);
  const updateMessageNicknameAndFaceUrl = useMessageStore(
    (state) => state.updateMessageNicknameAndFaceUrl,
  );
  const updateDownloadTask = useMessageStore((state) => state.updateDownloadTask);
  const removeDownloadTask = useMessageStore((state) => state.removeDownloadTask);
  // contact
  const updateFriend = useContactStore((state) => state.updateFriend);
  const setFriendList = useContactStore((state) => state.setFriendList);
  const updateBlack = useContactStore((state) => state.updateBlack);
  const pushNewBlack = useContactStore((state) => state.pushNewBlack);
  const updateGroup = useContactStore((state) => state.updateGroup);
  const pushNewGroup = useContactStore((state) => state.pushNewGroup);
  const updateRecvFriendApplication = useContactStore(
    (state) => state.updateRecvFriendApplication,
  );
  const updateSendFriendApplication = useContactStore(
    (state) => state.updateSendFriendApplication,
  );
  const updateRecvGroupApplication = useContactStore(
    (state) => state.updateRecvGroupApplication,
  );
  const updateSendGroupApplication = useContactStore(
    (state) => state.updateSendGroupApplication,
  );

  let cacheConversationList = [] as ConversationItem[];
  let audioEl: HTMLAudioElement | null = null;

  useEffect(() => {
    const pendingFriends = pendingAddedFriends.current;
    const pendingConversations = pendingConversationChanges.current;
    const pendingSyncMessages = pendingSyncCurrentMessages.current;
    loginCheck();
    cacheConversationList = [];
    setIMListener();
    return () => {
      if (syncRetryTimer.current) {
        clearTimeout(syncRetryTimer.current);
      }
      if (syncFallbackTimer.current) {
        clearTimeout(syncFallbackTimer.current);
      }
      if (conversationChangeFlushTimer.current) {
        clearTimeout(conversationChangeFlushTimer.current);
      }
      if (conversationChangeIdleCallback.current !== undefined) {
        window.cancelIdleCallback(conversationChangeIdleCallback.current);
      }
      if (conversationEventProcessTimer.current) {
        clearTimeout(conversationEventProcessTimer.current);
      }
      pendingConversationEventBatches.current = [];
      pendingConversationTerminalHandler.current = undefined;
      pendingConversations.clear();
      if (syncCurrentMessageFlushTimer.current) {
        clearTimeout(syncCurrentMessageFlushTimer.current);
      }
      pendingSyncMessages.clear();
      if (friendAddedFlushTimer.current) {
        clearTimeout(friendAddedFlushTimer.current);
      }
      pendingFriends.clear();
      disposeIMListener();
    };
  }, []);

  useEffect(() => {
    const notifyNetworkRecovered = () => {
      if (syncRetryTimer.current) {
        clearTimeout(syncRetryTimer.current);
        syncRetryTimer.current = undefined;
      }
      syncRetryCount.current = 0;
      void IMSDK.networkStatusChanged().catch((error) => {
        console.error("notify sdk network recovered failed", error);
      });
    };
    window.addEventListener("online", notifyNetworkRecovered);
    return () => window.removeEventListener("online", notifyNetworkRecovered);
  }, []);

  useEffect(() => {
    const getContactStoreDataHandler = (key: string) => {
      window.electronAPI?.ipcInvoke("transferContactStoreData", {
        key,
        data: JSON.stringify({
          friendList: useContactStore.getState().friendList,
          groupList: useContactStore.getState().groupList,
        }),
      });
    };

    const downloadSuccessHandler = (url: string, savePath: string) => {
      const task = useMessageStore.getState().downloadMap[url];
      finishAutoDownload(url);
      if (!task) return;
      const { clientMsgID, conversationID, originUrl, isMediaMessage, isThumb } = task;
      if (isThumb && originUrl) {
        addImageCache(originUrl, savePath);
      }

      setTimeout(() => removeDownloadTask(url), 2000);
      if (!clientMsgID || !conversationID) return;
      IMSDK.setMessageLocalEx({
        clientMsgID,
        conversationID,
        localEx: savePath,
      }).then(() =>
        updateOneMessage(
          {
            clientMsgID,
            localEx: savePath,
          } as ExMessageItem,
          isMediaMessage,
        ),
      );
    };
    const unsubscribeContactStoreData = window.electronAPI?.subscribe(
      "getContactStoreData",
      getContactStoreDataHandler,
    );
    const unsubscribeDownloadSuccess = window.electronAPI?.subscribe(
      "downloadSuccess",
      downloadSuccessHandler,
    );
    return () => {
      unsubscribeContactStoreData?.();
      unsubscribeDownloadSuccess?.();
    };
  }, []);

  useEffect(() => {
    const downloadProgressHandler = (url: string, progress: number) => {
      const task = useMessageStore.getState().downloadMap[url];
      if (!task || (task.isThumb && !task.workMomentID)) return;
      updateDownloadTask(url, {
        progress,
      });
    };
    const downloadSuccessHandler = (url: string) => {
      finishAutoDownload(url);
      const task = useMessageStore.getState().downloadMap[url];
      if (!task || (task.isThumb && !task.workMomentID)) return;
      updateDownloadTask(url, {
        progress: 0,
        downloadState: "finish",
      });
    };
    const downloadCancelHandler = (url: string) => {
      finishAutoDownload(url);
      const task = useMessageStore.getState().downloadMap[url];
      if (!task) return;
      removeDownloadTask(url);
    };
    const downloadFailedHandler = (url: string) => {
      finishAutoDownload(url);
      const task = useMessageStore.getState().downloadMap[url];
      if (!task) return;
      removeDownloadTask(url);
      if (task.showError) antdMessage.error(t("toast.applyDownloadFailed"));
    };
    const unsubscribeProgress = window.electronAPI?.subscribe(
      "downloadProgress",
      downloadProgressHandler,
    );
    const unsubscribeSuccess = window.electronAPI?.subscribe(
      "downloadSuccess",
      downloadSuccessHandler,
    );
    const unsubscribeCancel = window.electronAPI?.subscribe(
      "downloadCancel",
      downloadCancelHandler,
    );
    const unsubscribeFailed = window.electronAPI?.subscribe(
      "downloadFailed",
      downloadFailedHandler,
    );
    return () => {
      unsubscribeProgress?.();
      unsubscribeSuccess?.();
      unsubscribeCancel?.();
      unsubscribeFailed?.();
    };
  }, []);

  const loginCheck = async () => {
    const IMToken = (await getIMToken()) as string;
    const IMUserID = (await getIMUserID()) as string;
    if (!IMToken || !IMUserID) {
      await clearIMProfile();
      navigate("/login");
      return;
    }
    tryLogin();
  };

  const tryLogin = async () => {
    setConnectState((state) => ({ ...state, isLogining: true }));
    const IMToken = (await getIMToken()) as string;
    const IMUserID = (await getIMUserID()) as string;
    try {
      await IMSDK.login({
        userID: IMUserID,
        token: IMToken,
        platformID: window.electronAPI?.getPlatform() ?? 5,
        apiAddr: getApiUrl(),
        wsAddr: getWsUrl(),
        logLevel: LogLevel.Error,
        isLogStandardOutput: false,
      });
      window.electronAPI?.ipcInvoke("setUserCachePath", IMUserID);
      initStore();
    } catch (error) {
      if ((error as WsResponse).errCode === 10102) {
        window.electronAPI?.ipcInvoke("setUserCachePath", IMUserID);
        initStore();
      } else {
        await clearIMProfile();
        navigate("/login");
      }
    } finally {
      setConnectState((state) => ({ ...state, isLogining: false }));
    }
  };

  const setIMListener = () => {
    // account
    IMSDK.on(CbEvents.OnSelfInfoUpdated, selfUpdateHandler);
    IMSDK.on(CbEvents.OnConnecting, connectingHandler);
    IMSDK.on(CbEvents.OnConnectFailed, connectFailedHandler);
    IMSDK.on(CbEvents.OnConnectSuccess, connectSuccessHandler);
    IMSDK.on(CbEvents.OnKickedOffline, kickHandler);
    IMSDK.on(CbEvents.OnUserTokenExpired, expiredHandler);
    // sync
    IMSDK.on(CbEvents.OnSyncServerStart, syncStartHandler);
    IMSDK.on(CbEvents.OnSyncServerFinish, syncFinishHandler);
    IMSDK.on(CbEvents.OnSyncServerFailed, syncFailedHandler);
    // message
    IMSDK.on(CbEvents.OnRecvNewMessage, liveMessageHandler);
    IMSDK.on(CbEvents.OnRecvNewMessages, bulkMessageHandler);
    IMSDK.on(CbEvents.OnNewRecvMessageRevoked, revokedMessageHandler);
    // conversation
    IMSDK.on(CbEvents.OnConversationChanged, conversationChnageHandler);
    IMSDK.on(CbEvents.OnNewConversation, newConversationHandler);
    IMSDK.on(CbEvents.OnTotalUnreadMessageCountChanged, totalUnreadChangeHandler);
    // friend
    IMSDK.on(CbEvents.OnFriendInfoChanged, friednInfoChangeHandler);
    IMSDK.on(CbEvents.OnFriendAdded, friednAddedHandler);
    IMSDK.on(CbEvents.OnFriendDeleted, friednDeletedHandler);
    // blacklist
    IMSDK.on(CbEvents.OnBlackAdded, blackAddedHandler);
    IMSDK.on(CbEvents.OnBlackDeleted, blackDeletedHandler);
    // group
    IMSDK.on(CbEvents.OnJoinedGroupAdded, joinedGroupAddedHandler);
    IMSDK.on(CbEvents.OnJoinedGroupDeleted, joinedGroupDeletedHandler);
    IMSDK.on(CbEvents.OnGroupDismissed, joinedGroupDismissHandler);
    IMSDK.on(CbEvents.OnGroupInfoChanged, groupInfoChangedHandler);
    IMSDK.on(CbEvents.OnGroupMemberAdded, groupMemberAddedHandler);
    IMSDK.on(CbEvents.OnGroupMemberDeleted, groupMemberDeletedHandler);
    IMSDK.on(CbEvents.OnGroupMemberInfoChanged, groupMemberInfoChangedHandler);
    // application
    IMSDK.on(CbEvents.OnFriendApplicationAdded, friendApplicationProcessedHandler);
    IMSDK.on(CbEvents.OnFriendApplicationAccepted, friendApplicationProcessedHandler);
    IMSDK.on(CbEvents.OnFriendApplicationRejected, friendApplicationProcessedHandler);
    IMSDK.on(CbEvents.OnGroupApplicationAdded, groupApplicationProcessedHandler);
    IMSDK.on(CbEvents.OnGroupApplicationAccepted, groupApplicationProcessedHandler);
    IMSDK.on(CbEvents.OnGroupApplicationRejected, groupApplicationProcessedHandler);
    // custom
    IMSDK.on(CbEvents.OnRecvCustomBusinessMessage, customMessageHandler);
  };

  const selfUpdateHandler = ({ data }: WSEvent<SelfUserInfo>) => {
    updateSelfInfo(data);
  };
  const connectingHandler = () => {
    console.log("connecting...");
  };
  const connectFailedHandler = ({ errCode, errMsg }: WSEvent) => {
    console.error("connectFailedHandler");
    console.error(errCode, errMsg);

    if (errCode === 705) {
      tryOut(t("toast.loginExpiration"));
    }
  };
  const connectSuccessHandler = () => {
    console.log("connect success...");
  };
  const kickHandler = () => tryOut(t("toast.accountKicked"));
  const expiredHandler = () => tryOut(t("toast.loginExpiration"));

  const tryOut = (msg: string) =>
    feedbackToast({
      msg,
      error: msg,
      onClose: () => {
        userLogout(true);
      },
    });

  // sync
  const flushPendingSyncCurrentMessages = () => {
    if (syncCurrentMessageFlushTimer.current) {
      clearTimeout(syncCurrentMessageFlushTimer.current);
      syncCurrentMessageFlushTimer.current = undefined;
    }
    if (!pendingSyncCurrentMessages.current.size) return;
    const messages = Array.from(pendingSyncCurrentMessages.current.values());
    pendingSyncCurrentMessages.current.clear();
    handleCurrentMessagesBatch(messages);
  };

  const syncStartHandler = () => {
    const isInitialSync = !initialSyncFinished.current;
    const shouldShowSyncIndicator =
      isInitialSync && !initialSyncIndicatorDismissed.current;
    backgroundSyncing.current = true;
    useConversationStore.getState().updateSyncing(shouldShowSyncIndicator);
    if (syncRetryTimer.current) {
      clearTimeout(syncRetryTimer.current);
      syncRetryTimer.current = undefined;
    }
    setConnectState((state) => ({ ...state, isSyncing: true }));
    if (!syncFallbackTimer.current) {
      syncFallbackTimer.current = setTimeout(() => {
        initialSyncIndicatorDismissed.current = true;
        syncFallbackTimer.current = undefined;
        useConversationStore.getState().updateSyncing(false);
        flushPendingConversationChanges();
        const conversationList = useConversationStore.getState().conversationList;
        updateConversationList(conversationList, "filter");
      }, 15000);
    }
  };

  const finalizeSyncFinish = () => {
    backgroundSyncing.current = false;
    initialSyncIndicatorDismissed.current = true;
    useConversationStore.getState().updateSyncing(false);
    flushPendingConversationChanges();
    const conversationList = useConversationStore.getState().conversationList;
    updateConversationList(conversationList, "filter");
    if (syncRetryTimer.current) {
      clearTimeout(syncRetryTimer.current);
      syncRetryTimer.current = undefined;
    }
    if (syncFallbackTimer.current) {
      clearTimeout(syncFallbackTimer.current);
      syncFallbackTimer.current = undefined;
    }
    syncRetryCount.current = 0;
    initialSyncFinished.current = true;
    // 登录同步完成: 服务端窗口内的会话此时已写入本地库。
    // login 后立即执行的 initStore 在同步完成前本地库为空(大账号同步耗时较长),
    // 此处必须重新拉取一次会话列表, 否则首次登录会出现"会话列表空白"。
    const conversationStore = useConversationStore.getState();
    conversationStore.getConversationListByReq();
    void conversationStore.getUnReadCountByReq().then((unreadCount) => {
      window.electronAPI?.ipcInvoke("updateUnreadCount", unreadCount);
    });
    setConnectState((state) => ({ ...state, isSyncing: false }));
    flushPendingSyncCurrentMessages();
    emitter.emit("REFRESH_CHAT_LIST");
  };

  const syncFinishHandler = () => {
    if (pendingConversationEventBatches.current.length) {
      pendingConversationTerminalHandler.current = finalizeSyncFinish;
      scheduleConversationEventProcessing();
      return;
    }
    finalizeSyncFinish();
  };

  const finalizeSyncFailed = (event: WSEvent) => {
    backgroundSyncing.current = false;
    initialSyncIndicatorDismissed.current = true;
    useConversationStore.getState().updateSyncing(false);
    flushPendingConversationChanges();
    const conversationList = useConversationStore.getState().conversationList;
    updateConversationList(conversationList, "filter");
    if (syncFallbackTimer.current) {
      clearTimeout(syncFallbackTimer.current);
      syncFallbackTimer.current = undefined;
    }
    console.error("sync failed", {
      errCode: event?.errCode,
      errMsg: event?.errMsg,
      failedAttempt: syncRetryCount.current + 1,
      online: navigator.onLine,
    });
    if (syncRetryCount.current === 0) {
      feedbackToast({ msg: t("toast.syncFailed"), error: t("toast.syncFailed") });
    }
    // 同步失败也要尝试刷新一次: 部分数据(如已入库的窗口内会话)仍可展示
    useConversationStore.getState().getConversationListByReq();
    setConnectState((state) => ({ ...state, isSyncing: false }));
    flushPendingSyncCurrentMessages();
    if (syncRetryCount.current >= 3 || syncRetryTimer.current) return;

    syncRetryCount.current += 1;
    syncRetryTimer.current = setTimeout(() => {
      syncRetryTimer.current = undefined;
      void IMSDK.networkStatusChanged().catch((error) => {
        console.error("retry sdk sync failed", error);
      });
    }, syncRetryCount.current * 5000);
  };

  const syncFailedHandler = (event: WSEvent) => {
    if (pendingConversationEventBatches.current.length) {
      pendingConversationTerminalHandler.current = () => finalizeSyncFailed(event);
      scheduleConversationEventProcessing();
      return;
    }
    finalizeSyncFailed(event);
  };

  // message
  const syncCurrentGroupMuteStatus = (message: ExMessageItem) => {
    if (
      message.contentType !== MessageType.GroupMuted &&
      message.contentType !== MessageType.GroupCancelMuted
    ) {
      return;
    }

    const conversationStore = useConversationStore.getState();
    const currentGroupInfo = conversationStore.currentGroupInfo;
    if (!currentGroupInfo || currentGroupInfo.groupID !== message.groupID) return;

    const status =
      message.contentType === MessageType.GroupMuted
        ? GroupStatus.Muted
        : GroupStatus.Nomal;
    if (currentGroupInfo.status === status) return;

    conversationStore.updateCurrentGroupInfo({ ...currentGroupInfo, status });
  };

  const syncLiveConversationLatest = (messages: ExMessageItem[], urgent = false) => {
    if (!messages.length) return;

    const conversationStore = useConversationStore.getState();
    const selfUserID = useUserStore.getState().selfInfo.userID;
    const groupConversationMap = new Map<string, ConversationItem>();
    const userConversationMap = new Map<string, ConversationItem>();
    conversationStore.conversationList.forEach((conversation) => {
      if (conversation.groupID) {
        groupConversationMap.set(conversation.groupID, conversation);
      }
      if (conversation.userID) {
        userConversationMap.set(conversation.userID, conversation);
      }
    });
    const changes = new Map<string, ConversationItem>();

    messages.forEach((message) => {
      if (
        message.contentType === MessageType.TypingMessage ||
        message.contentType === MessageType.RevokeMessage
      ) {
        return;
      }

      const sourceID = isGroupSession(message.sessionType)
        ? message.groupID
        : message.sendID === selfUserID
        ? message.recvID
        : message.sendID;
      const conversation = isGroupSession(message.sessionType)
        ? groupConversationMap.get(sourceID)
        : userConversationMap.get(sourceID);
      if (!conversation) return;

      const currentConversation =
        changes.get(conversation.conversationID) ?? conversation;
      const nextConversation = preserveNewerConversationLatest(currentConversation, {
        ...currentConversation,
        latestMsg: JSON.stringify(message),
        latestMsgSendTime: message.sendTime,
      });
      if (
        nextConversation.latestMsg === currentConversation.latestMsg &&
        nextConversation.latestMsgSendTime === currentConversation.latestMsgSendTime
      ) {
        return;
      }
      changes.set(conversation.conversationID, nextConversation);
    });

    if (!changes.size) return;

    if (urgent) {
      updateConversationList(Array.from(changes.values()), "filter");
      return;
    }

    changes.forEach((conversation, conversationID) => {
      const pendingConversation =
        pendingConversationChanges.current.get(conversationID);
      pendingConversationChanges.current.set(
        conversationID,
        pendingConversation
          ? preserveNewerConversationLatest(pendingConversation, conversation)
          : conversation,
      );
    });
    scheduleConversationChangeFlush();
  };

  const liveMessageHandler = (event: WSEvent<ExMessageItem | ExMessageItem[]>) => {
    const messages = normalizeNewMessages(event.data);
    syncLiveConversationLatest(messages, true);
    handleNewMessages(messages, true);
  };

  const bulkMessageHandler = (event: WSEvent<ExMessageItem | ExMessageItem[]>) => {
    const messages = normalizeNewMessages(event.data);
    if (!backgroundSyncing.current) syncLiveConversationLatest(messages);
    handleNewMessages(messages);
  };

  const handleNewMessages = (messages: ExMessageItem[], isLive = false) => {
    if (!messages.length) return;
    messages.forEach(syncCurrentGroupMuteStatus);
    if (latestConnectState.current?.isSyncing && !isLive) {
      messages.filter(inCurrentConversation).forEach((message) => {
        const messageKey = message.clientMsgID || message.serverMsgID;
        if (messageKey) {
          pendingSyncCurrentMessages.current.set(messageKey, message);
        }
      });
      if (
        pendingSyncCurrentMessages.current.size &&
        !syncCurrentMessageFlushTimer.current
      ) {
        syncCurrentMessageFlushTimer.current = setTimeout(
          flushPendingSyncCurrentMessages,
          SYNC_CURRENT_MESSAGE_BATCH_MS,
        );
      }
      return;
    }
    if (messages.length === 1) {
      handleNewMessage(messages[0]);
      return;
    }
    const currentMessages: ExMessageItem[] = [];
    messages.forEach((message) => {
      if (inCurrentConversation(message)) {
        currentMessages.push(message);
        return;
      }
      handleNewMessage(message);
    });
    handleCurrentMessagesBatch(currentMessages);
  };

  const revokedMessageHandler = ({ data }: WSEvent<RevokedInfo>) => {
    updateOneMessage({
      clientMsgID: data.clientMsgID,
      contentType: MessageType.RevokeMessage,
      isAppend: true,
      notificationElem: {
        detail: JSON.stringify(data),
      },
    } as ExMessageItem);
  };

  const newMessageNotify = async (newServerMsg: ExMessageItem) => {
    if (latestConnectState.current?.isSyncing) {
      return;
    }

    const selfInfo = useUserStore.getState().selfInfo;

    if (
      selfInfo.allowBeep === BusinessAllowType.NotAllow ||
      selfInfo.globalRecvMsgOpt !== MessageReceiveOptType.Nomal
    ) {
      return;
    }

    let cveItem = [
      ...useConversationStore.getState().conversationList,
      ...cacheConversationList,
    ].find((conversation) => {
      if (isGroupSession(newServerMsg.sessionType)) {
        return newServerMsg.groupID === conversation.groupID;
      }
      return newServerMsg.sendID === conversation.userID;
    });

    if (!cveItem) {
      try {
        const { data } = await IMSDK.getOneConversation({
          sessionType: newServerMsg.sessionType,
          sourceID: newServerMsg.groupID || newServerMsg.sendID,
        });
        cveItem = data;
        cacheConversationList = [...cacheConversationList, { ...cveItem }];
      } catch (e) {
        return;
      }
    }

    if (cveItem.recvMsgOpt !== MessageReceiveOptType.Nomal) {
      return;
    }

    createNotification({
      message: newServerMsg,
      conversation: cveItem,
      callback: (conversation) => {
        if (
          useConversationStore.getState().currentConversation?.conversationID ===
          conversation.conversationID
        )
          return;
        updateCurrentConversation({ ...conversation, unreadCount: 1 });
        navigate(`/chat/${conversation.conversationID}`);
      },
    });

    if (!audioEl) {
      audioEl = document.createElement("audio");
    }
    audioEl.src = messageRing;
    void audioEl.play().catch(() => undefined);
  };

  const { run: checkOnline } = useThrottleFn(() => emitter.emit("ONLINE_STATE_CHECK"), {
    wait: 2000,
  });

  const { run: checkTyping } = useThrottleFn(() => emitter.emit("TYPING_UPDATE"), {
    wait: 2000,
  });

  const { run: newMessageNotification } = useThrottleFn(newMessageNotify, {
    wait: 2000,
  });

  const notPushType = [MessageType.TypingMessage, MessageType.RevokeMessage];

  const handleCurrentMessagesBatch = (messages: ExMessageItem[]) => {
    const visibleMessages = messages.filter(inCurrentConversation);
    if (!visibleMessages.length) return;

    if (visibleMessages.some((message) => message.sessionType === SessionType.Single)) {
      if (
        visibleMessages.some(
          (message) => message.contentType === MessageType.TypingMessage,
        )
      ) {
        checkTyping();
      }
      checkOnline();
    }

    const pushableMessages = visibleMessages.filter(
      (message) => !notPushType.includes(message.contentType),
    );
    if (!pushableMessages.length) return;

    const selfUserID = useUserStore.getState().selfInfo.userID;
    const preparedMessages = pushableMessages.map((message) => ({
      ...message,
      isAppend:
        message.sendID !== selfUserID ||
        SystemMessageTypes.includes(message.contentType),
    }));
    if (useMessageStore.getState().jumpClientMsgID) {
      preparedMessages.forEach((message) => {
        if (message.isAppend) emitter.emit("ADD_NEW_MESSAGE_COUNT");
      });
      return;
    }

    pushNewMessages(preparedMessages);
    emitter.emit("CHAT_LIST_SCROLL_TO_BOTTOM", false);
  };

  const handleNewMessage = (newServerMsg: ExMessageItem) => {
    if (!inCurrentConversation(newServerMsg)) {
      const needNotification =
        !notPushType.includes(newServerMsg.contentType) &&
        newServerMsg.sendID !== useUserStore.getState().selfInfo.userID;
      if (needNotification) {
        newMessageNotification(newServerMsg);
      }
      return;
    }
    const isSingleMessage = newServerMsg.sessionType === SessionType.Single;

    if (isSingleMessage) {
      if (newServerMsg.contentType === MessageType.TypingMessage) {
        checkTyping();
      }
      checkOnline();
    }

    if (!notPushType.includes(newServerMsg.contentType)) {
      const needAppend =
        newServerMsg.sendID !== useUserStore.getState().selfInfo.userID ||
        SystemMessageTypes.includes(newServerMsg.contentType);
      if (useMessageStore.getState().jumpClientMsgID) {
        if (needAppend) {
          emitter.emit("ADD_NEW_MESSAGE_COUNT");
        }
        return;
      }
      newServerMsg.isAppend = needAppend;
      pushNewMessage(newServerMsg);
      emitter.emit("CHAT_LIST_SCROLL_TO_BOTTOM", false);
    }
  };

  const inCurrentConversation = (newServerMsg: ExMessageItem) => {
    switch (newServerMsg.sessionType) {
      case SessionType.Single:
        return (
          newServerMsg.sendID ===
            useConversationStore.getState().currentConversation?.userID ||
          (newServerMsg.sendID === useUserStore.getState().selfInfo.userID &&
            newServerMsg.recvID ===
              useConversationStore.getState().currentConversation?.userID)
        );
      case SessionType.Group:
      case SessionType.WorkingGroup:
        return (
          newServerMsg.groupID ===
          useConversationStore.getState().currentConversation?.groupID
        );
      case SessionType.Notification:
        return (
          newServerMsg.sendID ===
          useConversationStore.getState().currentConversation?.userID
        );
      default:
        return false;
    }
  };

  // conversation
  const flushPendingConversationChanges = () => {
    if (conversationChangeFlushTimer.current) {
      clearTimeout(conversationChangeFlushTimer.current);
      conversationChangeFlushTimer.current = undefined;
    }
    if (conversationChangeIdleCallback.current !== undefined) {
      window.cancelIdleCallback(conversationChangeIdleCallback.current);
      conversationChangeIdleCallback.current = undefined;
    }
    if (pendingConversationChanges.current.size === 0) return false;

    const conversationList = useConversationStore.getState().conversationList;
    const changes = Array.from(pendingConversationChanges.current.values());
    const changeIndexMap = new Map(
      changes.map((conversation, index) => [conversation.conversationID, index]),
    );
    conversationList.forEach((currentConversation) => {
      const changeIndex = changeIndexMap.get(currentConversation.conversationID);
      if (changeIndex === undefined) return;
      changes[changeIndex] = preserveNewerConversationLatest(
        currentConversation,
        changes[changeIndex],
      );
    });
    pendingConversationChanges.current.clear();
    updateConversationList(changes, backgroundSyncing.current ? "preserve" : "filter");
    return true;
  };

  const scheduleConversationChangeFlush = () => {
    if (
      conversationChangeFlushTimer.current ||
      conversationChangeIdleCallback.current !== undefined
    ) {
      return;
    }

    conversationChangeFlushTimer.current = setTimeout(
      () => {
        conversationChangeFlushTimer.current = undefined;
        if (
          backgroundSyncing.current &&
          typeof window.requestIdleCallback === "function"
        ) {
          conversationChangeIdleCallback.current = window.requestIdleCallback(
            () => {
              conversationChangeIdleCallback.current = undefined;
              flushPendingConversationChanges();
            },
            { timeout: CONVERSATION_FLUSH_IDLE_TIMEOUT_MS },
          );
          return;
        }
        flushPendingConversationChanges();
      },
      backgroundSyncing.current
        ? SYNC_CONVERSATION_EVENT_BATCH_MS
        : CONVERSATION_EVENT_BATCH_MS,
    );
  };

  const processPendingConversationEvents = () => {
    conversationEventProcessTimer.current = undefined;
    const startedAt = performance.now();
    let processedCount = 0;
    const eventBatches = pendingConversationEventBatches.current;

    while (eventBatches.length) {
      const batch = eventBatches[0];
      while (batch.index < batch.data.length) {
        const conversation = batch.data[batch.index++];
        processedCount += 1;
        const pendingConversation = pendingConversationChanges.current.get(
          conversation.conversationID,
        );
        pendingConversationChanges.current.set(
          conversation.conversationID,
          pendingConversation
            ? preserveNewerConversationLatest(pendingConversation, conversation)
            : conversation,
        );
        if (
          processedCount >= CONVERSATION_EVENT_CHUNK_SIZE ||
          performance.now() - startedAt >= CONVERSATION_EVENT_CHUNK_BUDGET_MS
        ) {
          break;
        }
      }
      if (batch.index >= batch.data.length) {
        eventBatches.shift();
      }
      if (
        processedCount >= CONVERSATION_EVENT_CHUNK_SIZE ||
        performance.now() - startedAt >= CONVERSATION_EVENT_CHUNK_BUDGET_MS
      ) {
        break;
      }
    }

    if (pendingConversationChanges.current.size) {
      scheduleConversationChangeFlush();
    }
    if (eventBatches.length) {
      scheduleConversationEventProcessing();
      return;
    }

    const terminalHandler = pendingConversationTerminalHandler.current;
    if (terminalHandler) {
      pendingConversationTerminalHandler.current = undefined;
      terminalHandler();
    }
  };

  const scheduleConversationEventProcessing = () => {
    if (
      conversationEventProcessTimer.current ||
      !pendingConversationEventBatches.current.length
    ) {
      return;
    }
    conversationEventProcessTimer.current = setTimeout(
      processPendingConversationEvents,
      latestConnectState.current?.isSyncing ? 16 : 0,
    );
  };

  const scheduleConversationChanges = (conversations: ConversationItem[]) => {
    if (!conversations.length) return;
    pendingConversationEventBatches.current.push({
      data: conversations,
      index: 0,
    });
    scheduleConversationEventProcessing();
  };

  const conversationChnageHandler = ({ data }: WSEvent<ConversationItem[]>) => {
    scheduleConversationChanges(data);
  };
  const newConversationHandler = ({ data }: WSEvent<ConversationItem[]>) => {
    scheduleConversationChanges(data);
  };
  const totalUnreadChangeHandler = ({ data }: WSEvent<number>) => {
    updateUnReadCount(data);
    if (!latestConnectState.current?.isSyncing) {
      window.electronAPI?.ipcInvoke("updateUnreadCount", data);
    }
  };

  // friend
  const flushPendingAddedFriends = () => {
    friendAddedFlushTimer.current = undefined;
    if (!pendingAddedFriends.current.size) return;
    const friendMap = new Map(
      useContactStore.getState().friendList.map((friend) => [friend.userID, friend]),
    );
    pendingAddedFriends.current.forEach((friend, userID) => {
      friendMap.set(userID, friend);
    });
    pendingAddedFriends.current.clear();
    setFriendList(Array.from(friendMap.values()));
  };

  const friednInfoChangeHandler = ({ data }: WSEvent<FriendUserItem>) => {
    if (data.userID === useConversationStore.getState().currentConversation?.userID) {
      updateMessageNicknameAndFaceUrl({
        sendID: data.userID,
        senderNickname: data.remark || data.nickname,
        senderFaceUrl: data.faceURL,
      });
    }
    if (pendingAddedFriends.current.has(data.userID)) {
      pendingAddedFriends.current.set(data.userID, data);
    }
    updateFriend(data);
  };
  const friednAddedHandler = ({ data }: WSEvent<FriendUserItem>) => {
    pendingAddedFriends.current.set(data.userID, data);
    if (!friendAddedFlushTimer.current) {
      friendAddedFlushTimer.current = setTimeout(flushPendingAddedFriends, 500);
    }
  };
  const friednDeletedHandler = ({ data }: WSEvent<FriendUserItem>) => {
    pendingAddedFriends.current.delete(data.userID);
    updateFriend(data, true);
  };

  // blacklist
  const blackAddedHandler = ({ data }: WSEvent<BlackUserItem>) => {
    pushNewBlack(data);
  };
  const blackDeletedHandler = ({ data }: WSEvent<BlackUserItem>) => {
    updateBlack(data, true);
  };

  // group
  const joinedGroupAddedHandler = ({ data }: WSEvent<GroupItem>) => {
    if (data.groupID === useConversationStore.getState().currentConversation?.groupID) {
      updateCurrentGroupInfo(data);
      getCurrentMemberInGroupByReq(data.groupID);
    }
    pushNewGroup(data);
  };
  const joinedGroupDeletedHandler = ({ data }: WSEvent<GroupItem>) => {
    if (data.groupID === useConversationStore.getState().currentConversation?.groupID) {
      getCurrentGroupInfoByReq(data.groupID);
      // getCurrentMemberInGroupByReq(data.groupID);
    }
    updateGroup(data, true);
  };
  const joinedGroupDismissHandler = ({ data }: WSEvent<GroupItem>) => {
    if (data.groupID === useConversationStore.getState().currentConversation?.groupID) {
      getCurrentMemberInGroupByReq(data.groupID);
    }
  };
  const groupInfoChangedHandler = ({ data }: WSEvent<GroupItem>) => {
    updateGroup(data);
    if (data.groupID === useConversationStore.getState().currentConversation?.groupID) {
      updateCurrentGroupInfo(data);
    }
  };
  const groupMemberAddedHandler = ({ data }: WSEvent<GroupMemberItem>) => {
    if (
      data.groupID === useConversationStore.getState().currentConversation?.groupID &&
      data.userID === useUserStore.getState().selfInfo.userID
    ) {
      getCurrentMemberInGroupByReq(data.groupID);
    }
  };
  const groupMemberDeletedHandler = ({ data }: WSEvent<GroupMemberItem>) => {
    if (
      data.groupID === useConversationStore.getState().currentConversation?.groupID &&
      data.userID === useUserStore.getState().selfInfo.userID
    ) {
      getCurrentMemberInGroupByReq(data.groupID);
    }
  };
  const groupMemberInfoChangedHandler = ({ data }: WSEvent<GroupMemberItem>) => {
    if (data.groupID === useConversationStore.getState().currentConversation?.groupID) {
      updateMessageNicknameAndFaceUrl({
        sendID: data.userID,
        senderNickname: data.nickname,
        senderFaceUrl: data.faceURL,
      });
      tryUpdateCurrentMemberInGroup(data);
    }
  };

  //application
  const friendApplicationProcessedHandler = ({
    data,
  }: WSEvent<FriendApplicationItem>) => {
    const isRecv = data.toUserID === useUserStore.getState().selfInfo.userID;
    if (isRecv) {
      updateRecvFriendApplication(data);
    } else {
      updateSendFriendApplication(data);
    }
  };
  const groupApplicationProcessedHandler = ({
    data,
  }: WSEvent<GroupApplicationItem>) => {
    const isRecv = data.userID !== useUserStore.getState().selfInfo.userID;
    if (isRecv) {
      updateRecvGroupApplication(data);
    } else {
      updateSendGroupApplication(data);
    }
  };

  // custom
  const customMessageHandler = ({
    data: { key },
  }: WSEvent<{ key: string; data: string }>) => {
    if (key.includes("wm_")) {
      getWorkMomentsUnreadCount();
    }
  };

  const disposeIMListener = () => {
    IMSDK.off(CbEvents.OnSelfInfoUpdated, selfUpdateHandler);
    IMSDK.off(CbEvents.OnConnecting, connectingHandler);
    IMSDK.off(CbEvents.OnConnectFailed, connectFailedHandler);
    IMSDK.off(CbEvents.OnConnectSuccess, connectSuccessHandler);
    IMSDK.off(CbEvents.OnKickedOffline, kickHandler);
    IMSDK.off(CbEvents.OnUserTokenExpired, expiredHandler);
    // sync
    IMSDK.off(CbEvents.OnSyncServerStart, syncStartHandler);
    IMSDK.off(CbEvents.OnSyncServerFinish, syncFinishHandler);
    IMSDK.off(CbEvents.OnSyncServerFailed, syncFailedHandler);
    // message
    IMSDK.off(CbEvents.OnRecvNewMessage, liveMessageHandler);
    IMSDK.off(CbEvents.OnRecvNewMessages, bulkMessageHandler);
    IMSDK.off(CbEvents.OnNewRecvMessageRevoked, revokedMessageHandler);
    // conversation
    IMSDK.off(CbEvents.OnConversationChanged, conversationChnageHandler);
    IMSDK.off(CbEvents.OnNewConversation, newConversationHandler);
    IMSDK.off(CbEvents.OnTotalUnreadMessageCountChanged, totalUnreadChangeHandler);
    // friend
    IMSDK.off(CbEvents.OnFriendInfoChanged, friednInfoChangeHandler);
    IMSDK.off(CbEvents.OnFriendAdded, friednAddedHandler);
    IMSDK.off(CbEvents.OnFriendDeleted, friednDeletedHandler);
    // blacklist
    IMSDK.off(CbEvents.OnBlackAdded, blackAddedHandler);
    IMSDK.off(CbEvents.OnBlackDeleted, blackDeletedHandler);
    // group
    IMSDK.off(CbEvents.OnJoinedGroupAdded, joinedGroupAddedHandler);
    IMSDK.off(CbEvents.OnJoinedGroupDeleted, joinedGroupDeletedHandler);
    IMSDK.off(CbEvents.OnGroupDismissed, joinedGroupDismissHandler);
    IMSDK.off(CbEvents.OnGroupInfoChanged, groupInfoChangedHandler);
    IMSDK.off(CbEvents.OnGroupMemberAdded, groupMemberAddedHandler);
    IMSDK.off(CbEvents.OnGroupMemberDeleted, groupMemberDeletedHandler);
    IMSDK.off(CbEvents.OnGroupMemberInfoChanged, groupMemberInfoChangedHandler);
    // application
    IMSDK.off(CbEvents.OnFriendApplicationAdded, friendApplicationProcessedHandler);
    IMSDK.off(CbEvents.OnFriendApplicationAccepted, friendApplicationProcessedHandler);
    IMSDK.off(CbEvents.OnFriendApplicationRejected, friendApplicationProcessedHandler);
    IMSDK.off(CbEvents.OnGroupApplicationAdded, groupApplicationProcessedHandler);
    IMSDK.off(CbEvents.OnGroupApplicationAccepted, groupApplicationProcessedHandler);
    IMSDK.off(CbEvents.OnGroupApplicationRejected, groupApplicationProcessedHandler);
    // custom
    IMSDK.off(CbEvents.OnRecvCustomBusinessMessage, customMessageHandler);
  };

  return [connectState];
}
