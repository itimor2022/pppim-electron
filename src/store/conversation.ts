import { t } from "i18next";
import { MessageType } from "open-im-sdk-wasm";
import {
  ConversationItem,
  GroupItem,
  GroupMemberItem,
  MessageItem,
} from "open-im-sdk-wasm/lib/types/entity";
import { create } from "zustand";

import { getServerGroupMembersInfo } from "@/api/imApi";
import { IMSDK } from "@/layout/MainContentWrap";
import { feedbackToast } from "@/utils/common";
import {
  conversationSort,
  isGroupSession,
  mergeConversationList,
} from "@/utils/imCommon";
import { scheduleIMSDKRequest } from "@/utils/imSdkRequestScheduler";

import { useMessageStore } from "./message";
import {
  ConversationListUpdateType,
  ConversationStore,
  RevokeMessageData,
} from "./type";
import { useUserStore } from "./user";

const CONVERSATION_SPLIT_COUNT = 500;
const MARK_READ_UNREAD_REFRESH_DELAY_MS = 200;

type PendingMarkRead = {
  promise: Promise<void>;
  latestRequestedConversation?: ConversationItem;
  latestRequestedMsg: string;
  latestRequestedSendTime: number;
};

const pendingMarkReadRequests = new Map<string, PendingMarkRead>();
let markReadUnreadRefreshTimer: ReturnType<typeof setTimeout> | undefined;

export const useConversationStore = create<ConversationStore>()((set, get) => ({
  conversationList: [],
  isSyncing: false,
  currentConversation: undefined,
  unReadCount: 0,
  currentGroupInfo: undefined,
  currentMemberInGroup: undefined,
  currentMemberInGroupLoading: false,
  quoteMessage: undefined,
  revokeMap: {} as Record<string, RevokeMessageData>,
  getConversationListByReq: async (isOffset?: boolean) => {
    let tmpConversationList = [] as ConversationItem[];
    try {
      const { data } = await IMSDK.getConversationListSplit({
        offset: isOffset ? get().conversationList.length : 0,
        count: CONVERSATION_SPLIT_COUNT,
      });
      tmpConversationList = data;
    } catch (error) {
      feedbackToast({ error, msg: t("toast.getConversationFailed") });
      return true;
    }
    set((state) => ({
      conversationList: conversationSort([
        ...(isOffset ? state.conversationList : []),
        ...tmpConversationList,
      ]),
    }));
    return tmpConversationList.length === CONVERSATION_SPLIT_COUNT;
  },
  updateConversationList: (
    list: ConversationItem[],
    type: ConversationListUpdateType,
  ) => {
    if (type === "filter" && list === get().conversationList) {
      set((state) => {
        const conversationList = conversationSort([...state.conversationList]);
        const orderChanged =
          conversationList.length !== state.conversationList.length ||
          conversationList.some(
            (conversation, index) => conversation !== state.conversationList[index],
          );
        return orderChanged ? { conversationList } : state;
      });
      return;
    }

    const idx = list.findIndex(
      (c) => c.conversationID === get().currentConversation?.conversationID,
    );
    if (idx > -1) get().updateCurrentConversation(list[idx]);

    if (type === "preserve") {
      set((state) => {
        const pendingConversationMap = new Map(
          list.map((conversation) => [conversation.conversationID, conversation]),
        );
        let listChanged = false;
        const conversationList = state.conversationList.map((conversation) => {
          const changedConversation = pendingConversationMap.get(
            conversation.conversationID,
          );
          if (!changedConversation) return conversation;
          pendingConversationMap.delete(conversation.conversationID);
          if (changedConversation !== conversation) listChanged = true;
          return changedConversation;
        });
        if (pendingConversationMap.size) {
          listChanged = true;
          conversationList.push(...pendingConversationMap.values());
        }
        return listChanged ? { conversationList } : state;
      });
      return;
    }

    set((state) => ({
      conversationList: mergeConversationList(state.conversationList, list),
    }));
  },
  updateSyncing: (isSyncing: boolean) => {
    set(() => ({ isSyncing }));
  },
  delConversationByCID: (conversationID: string) => {
    const tmpConversationList = get().conversationList;
    const idx = tmpConversationList.findIndex(
      (cve) => cve.conversationID === conversationID,
    );
    if (idx < 0) {
      return;
    }
    tmpConversationList.splice(idx, 1);
    set(() => ({ conversationList: [...tmpConversationList] }));
  },
  updateCurrentConversation: (conversation?: ConversationItem, isJump?: boolean) => {
    if (!conversation) {
      set(() => ({
        currentConversation: undefined,
        quoteMessage: undefined,
        currentGroupInfo: undefined,
        currentMemberInGroup: undefined,
        currentMemberInGroupLoading: false,
      }));
      return;
    }
    const prevConversation = get().currentConversation;

    const toggleNewConversation =
      conversation.conversationID !== prevConversation?.conversationID;
    if (toggleNewConversation && isGroupSession(conversation.conversationType)) {
      set(() => ({
        currentGroupInfo: undefined,
        currentMemberInGroup: undefined,
        currentMemberInGroupLoading: true,
      }));
      get().getCurrentGroupInfoByReq(conversation.groupID);
      get().getCurrentMemberInGroupByReq(conversation.groupID);
    } else if (toggleNewConversation) {
      set(() => ({
        currentGroupInfo: undefined,
        currentMemberInGroup: undefined,
        currentMemberInGroupLoading: false,
      }));
    }
    if (toggleNewConversation && !isJump) {
      useMessageStore.getState().updateJumpClientMsgID();
    }
    set(() => ({ currentConversation: { ...conversation } }));
  },
  markConversationAsReadByReq: async (conversation) => {
    const conversationID = conversation.conversationID;
    const pendingRequest = pendingMarkReadRequests.get(conversationID);
    if (pendingRequest) {
      const hasNewerRequest =
        conversation.latestMsgSendTime > pendingRequest.latestRequestedSendTime ||
        (conversation.latestMsgSendTime === pendingRequest.latestRequestedSendTime &&
          conversation.latestMsg !== pendingRequest.latestRequestedMsg);
      if (hasNewerRequest) {
        pendingRequest.latestRequestedConversation = conversation;
        pendingRequest.latestRequestedMsg = conversation.latestMsg;
        pendingRequest.latestRequestedSendTime = conversation.latestMsgSendTime;
      }
      return pendingRequest.promise;
    }

    const requestState: PendingMarkRead = {
      promise: Promise.resolve(),
      latestRequestedMsg: conversation.latestMsg,
      latestRequestedSendTime: conversation.latestMsgSendTime,
    };
    requestState.promise = (async () => {
      let targetConversation: ConversationItem | undefined = conversation;
      while (targetConversation) {
        requestState.latestRequestedConversation = undefined;
        await scheduleIMSDKRequest(
          () => IMSDK.markConversationMessageAsRead(targetConversation!.conversationID),
          { priority: "normal" },
        );

        const latestConversation = get().conversationList.find(
          (item) => item.conversationID === targetConversation?.conversationID,
        );
        const hasNewerMessage =
          (latestConversation?.latestMsgSendTime ?? 0) >
            targetConversation.latestMsgSendTime ||
          latestConversation?.latestMsg !== targetConversation.latestMsg;
        if (
          latestConversation &&
          !hasNewerMessage &&
          latestConversation.unreadCount > 0
        ) {
          get().updateConversationList(
            [{ ...latestConversation, unreadCount: 0 }],
            "filter",
          );
        }
        targetConversation = requestState.latestRequestedConversation;
      }

      if (markReadUnreadRefreshTimer) {
        clearTimeout(markReadUnreadRefreshTimer);
      }
      markReadUnreadRefreshTimer = setTimeout(() => {
        markReadUnreadRefreshTimer = undefined;
        void scheduleIMSDKRequest(() => IMSDK.getTotalUnreadMsgCount(), {
          priority: "normal",
        })
          .then(({ data }) => {
            get().updateUnReadCount(data);
            window.electronAPI?.ipcInvoke("updateUnreadCount", data);
          })
          .catch((error) => {
            console.error(
              "refresh total unread count after marking read failed",
              error,
            );
          });
      }, MARK_READ_UNREAD_REFRESH_DELAY_MS);
    })();
    pendingMarkReadRequests.set(conversationID, requestState);

    try {
      await requestState.promise;
    } finally {
      if (pendingMarkReadRequests.get(conversationID) === requestState) {
        pendingMarkReadRequests.delete(conversationID);
      }
    }
  },
  getUnReadCountByReq: async () => {
    try {
      const { data } = await scheduleIMSDKRequest(
        () => IMSDK.getTotalUnreadMsgCount(),
        { priority: "normal" },
      );
      set(() => ({ unReadCount: data }));
      return data;
    } catch (error) {
      console.error(error);
      return get().unReadCount;
    }
  },
  updateUnReadCount: (count: number) => {
    set(() => ({ unReadCount: count }));
  },
  getCurrentGroupInfoByReq: async (groupID: string) => {
    let groupInfo: GroupItem;
    try {
      const { data } = await IMSDK.getSpecifiedGroupsInfo([groupID]);
      groupInfo = data[0];
    } catch (error) {
      feedbackToast({ error, msg: t("toast.getGroupInfoFailed") });
      return;
    }
    if (get().currentConversation?.groupID !== groupID) {
      return;
    }
    set(() => ({ currentGroupInfo: { ...groupInfo } }));
  },
  updateCurrentGroupInfo: (groupInfo: GroupItem) => {
    set(() => ({ currentGroupInfo: { ...groupInfo } }));
  },
  getCurrentMemberInGroupByReq: async (groupID: string) => {
    let memberInfo: GroupMemberItem | undefined;
    let localMemberError: unknown;
    const selfID = useUserStore.getState().selfInfo.userID;
    set(() => ({ currentMemberInGroupLoading: true }));
    try {
      const { data } = await IMSDK.getSpecifiedGroupMembersInfo({
        groupID,
        userIDList: [selfID],
      });
      memberInfo = data[0];
    } catch (error) {
      localMemberError = error;
    }
    if (!memberInfo) {
      try {
        const { data } = await getServerGroupMembersInfo({
          groupID,
          userIDs: [selfID],
        });
        memberInfo = data.members?.[0];
      } catch (error) {
        feedbackToast({
          error: localMemberError ?? error,
          msg: t("toast.getGroupMemberFailed"),
        });
        set(() => ({ currentMemberInGroupLoading: false }));
        return;
      }
    }
    const currentGroupID = get().currentConversation?.groupID;
    if (currentGroupID !== groupID) {
      set(() => ({ currentMemberInGroupLoading: false }));
      return;
    }
    set(() => ({
      currentMemberInGroup: memberInfo ? { ...memberInfo } : undefined,
      currentMemberInGroupLoading: false,
    }));
  },
  tryUpdateCurrentMemberInGroup: (member: GroupMemberItem) => {
    const currentMemberInGroup = get().currentMemberInGroup;
    if (
      member.groupID === currentMemberInGroup?.groupID &&
      member.userID === currentMemberInGroup?.userID
    ) {
      set(() => ({ currentMemberInGroup: { ...member } }));
    }
  },
  updateQuoteMessage: (message?: MessageItem) => {
    set(() => ({ quoteMessage: message }));
  },
  addRevokedMessage: (message: MessageItem, quoteMessage?: MessageItem) => {
    set((state) => ({
      revokeMap: {
        ...state.revokeMap,
        [message.clientMsgID]: {
          text: getMessageText(message),
          quoteMessage,
        },
      },
    }));
  },
  clearConversationStore: () => {
    set(() => ({
      conversationList: [],
      isSyncing: false,
      currentConversation: undefined,
      unReadCount: 0,
      currentGroupInfo: undefined,
      currentMemberInGroup: undefined,
      currentMemberInGroupLoading: false,
      quoteMessage: undefined,
    }));
  },
}));

const getMessageText = (message: MessageItem) => {
  if (message.contentType === MessageType.AtTextMessage) {
    return message.atTextElem.text;
  }
  if (message.contentType === MessageType.QuoteMessage) {
    return message.quoteElem.text;
  }
  return message.textElem.content;
};
