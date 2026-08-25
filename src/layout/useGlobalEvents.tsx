import { useLatest, useThrottleFn } from "ahooks";
import { t } from "i18next";
import { CbEvents } from "open-im-sdk-wasm";
import {
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
import { useEffect, useState } from "react";
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
import { feedbackToast } from "@/utils/common";
import emitter from "@/utils/events";
import { createNotification, initStore, isGroupSession } from "@/utils/imCommon";
import { clearIMProfile, getIMToken, getIMUserID } from "@/utils/storage";

import { IMSDK } from "./MainContentWrap";

export function useGlobalEvent() {
  const navigate = useNavigate();
  const [connectState, setConnectState] = useState({
    isSyncing: false,
    isLogining: false,
    isConnecting: false,
  });
  const latestConnectState = useLatest(connectState);
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
  const tryAddPreviewImg = useMessageStore((state) => state.tryAddPreviewImg);
  const updateOneMessage = useMessageStore((state) => state.updateOneMessage);
  const updateMessageNicknameAndFaceUrl = useMessageStore(
    (state) => state.updateMessageNicknameAndFaceUrl,
  );
  const updateDownloadTask = useMessageStore((state) => state.updateDownloadTask);
  const removeDownloadTask = useMessageStore((state) => state.removeDownloadTask);
  // contact
  const updateFriend = useContactStore((state) => state.updateFriend);
  const pushNewFriend = useContactStore((state) => state.pushNewFriend);
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
    loginCheck();
    cacheConversationList = [];
    setIMListener();
    return () => {
      disposeIMListener();
    };
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
      const { clientMsgID, conversationID, originUrl, isMediaMessage, isThumb } =
        useMessageStore.getState().downloadMap[url];
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
      if (!task) return;
      updateDownloadTask(url, {
        progress,
      });
    };
    const downloadSuccessHandler = (url: string, filePath: string) => {
      const task = useMessageStore.getState().downloadMap[url];
      if (!task) return;
      updateDownloadTask(url, {
        progress: 0,
        downloadState: "finish",
      });
    };
    const downloadCancelHandler = (url: string) => {
      const task = useMessageStore.getState().downloadMap[url];
      if (!task) return;
      removeDownloadTask(url);
    };
    const downloadFailedHandler = (url: string) => {
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
      clearIMProfile();
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
        // 大账号同步期间 SDK 会产生海量请求/数据日志, 生产环境关闭 Debug 打印,
        // 避免浏览器 console 堆积几十万条消息导致卡顿。
        logLevel: import.meta.env.PROD ? LogLevel.Warn : LogLevel.Debug,
      });
      window.electronAPI?.ipcInvoke("setUserCachePath", IMUserID);
      initStore();
    } catch (error) {
      if ((error as WsResponse).errCode !== 10102) {
        clearIMProfile();
        navigate("/login");
      }
    }

    setConnectState((state) => ({ ...state, isLogining: false }));
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
    IMSDK.on(CbEvents.OnRecvNewMessage, newMessageHandler);
    IMSDK.on(CbEvents.OnRecvNewMessages, newMessageHandler);
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
  const syncStartHandler = () => {
    setConnectState((state) => ({ ...state, isSyncing: true }));
  };
  const syncFinishHandler = () => {
    window.electronAPI?.ipcInvoke(
      "updateUnreadCount",
      useConversationStore.getState().unReadCount,
    );
    // 登录同步完成: 服务端窗口内的会话此时已写入本地库。
    // login 后立即执行的 initStore 在同步完成前本地库为空(大账号同步耗时较长),
    // 此处必须重新拉取一次会话列表, 否则首次登录会出现"会话列表空白"。
    useConversationStore.getState().getConversationListByReq();
    setConnectState((state) => ({ ...state, isSyncing: false }));
  };
  const syncFailedHandler = () => {
    feedbackToast({ msg: t("toast.syncFailed"), error: t("toast.syncFailed") });
    // 同步失败也要尝试刷新一次: 部分数据(如已入库的窗口内会话)仍可展示
    useConversationStore.getState().getConversationListByReq();
    setConnectState((state) => ({ ...state, isSyncing: false }));
  };

  // message
  const newMessageHandler = ({ data }: WSEvent<ExMessageItem[]>) => {
    if (latestConnectState.current.isSyncing) {
      if (data.some((message) => inCurrentConversation(message))) {
        emitter.emit("REFRESH_CHAT_LIST");
      }
      return;
    }
    data.map((message) => handleNewMessage(message));
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
    if (latestConnectState.current.isSyncing) {
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
    audioEl.play();
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
      tryAddPreviewImg([newServerMsg]);
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
  const conversationChnageHandler = ({ data }: WSEvent<ConversationItem[]>) => {
    updateConversationList(data, "filter");
  };
  const newConversationHandler = ({ data }: WSEvent<ConversationItem[]>) => {
    updateConversationList(data, "push");
  };
  const totalUnreadChangeHandler = ({ data }: WSEvent<number>) => {
    updateUnReadCount(data);
    if (!latestConnectState.current.isSyncing) {
      window.electronAPI?.ipcInvoke("updateUnreadCount", data);
    }
  };

  // friend
  const friednInfoChangeHandler = ({ data }: WSEvent<FriendUserItem>) => {
    if (data.userID === useConversationStore.getState().currentConversation?.userID) {
      updateMessageNicknameAndFaceUrl({
        sendID: data.userID,
        senderNickname: data.remark || data.nickname,
        senderFaceUrl: data.faceURL,
      });
    }
    updateFriend(data);
  };
  const friednAddedHandler = ({ data }: WSEvent<FriendUserItem>) => {
    pushNewFriend(data);
  };
  const friednDeletedHandler = ({ data }: WSEvent<FriendUserItem>) => {
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
    IMSDK.off(CbEvents.OnRecvNewMessage, newMessageHandler);
    IMSDK.off(CbEvents.OnRecvNewMessages, newMessageHandler);
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
