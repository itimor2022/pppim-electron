import { t } from "i18next";
import { MessageType } from "open-im-sdk-wasm";
import {
  ConversationItem,
  GroupItem,
  GroupMemberItem,
  MessageItem,
} from "open-im-sdk-wasm/lib/types/entity";
import { create } from "zustand";

import {
  ConversationItemWithRemoteFlag,
  getActiveConversations,
  getServerGroupMembersInfo,
} from "@/api/imApi";
import { IMSDK } from "@/layout/MainContentWrap";
import { feedbackToast } from "@/utils/common";
import { conversationSort, isGroupSession } from "@/utils/imCommon";

import { useMessageStore } from "./message";
import {
  ConversationListUpdateType,
  ConversationStore,
  RevokeMessageData,
} from "./type";
import { useUserStore } from "./user";

const CONVERSATION_SPLIT_COUNT = 500;
const REMOTE_CONVERSATION_COUNT = 100;

export const useConversationStore = create<ConversationStore>()((set, get) => ({
  conversationList: [],
  currentConversation: undefined,
  unReadCount: 0,
  currentGroupInfo: undefined,
  currentMemberInGroup: undefined,
  currentMemberInGroupLoading: false,
  quoteMessage: undefined,
  revokeMap: {} as Record<string, RevokeMessageData>,
  localLoadedCount: 0,
  localExhausted: false,
  remoteLoadedCount: 0,
  remoteHasMore: true,
  remoteLoading: false,
  // 两阶段按量拉取:
  // 阶段一(本地): 从 SDK 本地库分页读取登录同步窗口内的会话;
  // 阶段二(远程): 本地耗尽后调用服务端分页接口"下拉加载"更老的会话。
  getConversationListByReq: async (isOffset?: boolean) => {
    if (!isOffset) {
      set(() => ({
        localLoadedCount: 0,
        localExhausted: false,
        remoteLoadedCount: 0,
        remoteHasMore: true,
        remoteLoading: false,
      }));
    }
    if (!get().localExhausted) {
      let tmpConversationList = [] as ConversationItem[];
      try {
        const { data } = await IMSDK.getConversationListSplit({
          offset: isOffset ? get().localLoadedCount : 0,
          count: CONVERSATION_SPLIT_COUNT,
        });
        tmpConversationList = data;
      } catch (error) {
        feedbackToast({ error, msg: t("toast.getConversationFailed") });
        return false;
      }
      set((state) => ({
        conversationList: [
          ...(isOffset ? state.conversationList : []),
          ...tmpConversationList,
        ],
        localLoadedCount:
          (isOffset ? state.localLoadedCount : 0) + tmpConversationList.length,
        localExhausted: tmpConversationList.length < CONVERSATION_SPLIT_COUNT,
      }));
      return true;
    }

    // 远程阶段: 服务端活跃会话分页
    if (get().remoteLoading) return true;
    if (!get().remoteHasMore) return false;
    set(() => ({ remoteLoading: true }));
    try {
      const offset = get().remoteLoadedCount;
      const { data } = await getActiveConversations({
        offset,
        count: REMOTE_CONVERSATION_COUNT,
      });
      const remoteItems =
        (data.conversations ?? []) as ConversationItemWithRemoteFlag[];
      const existIDs = new Set(
        get().conversationList.map((c) => c.conversationID),
      );
      const appendItems = remoteItems.filter(
        (item) => !existIDs.has(item.conversationID),
      );
      set((state) => ({
        conversationList: [...state.conversationList, ...appendItems],
        remoteLoadedCount: offset + remoteItems.length,
        remoteHasMore: offset + remoteItems.length < data.total,
      }));
      return get().remoteHasMore;
    } catch (error) {
      console.error(error);
      return false;
    } finally {
      set(() => ({ remoteLoading: false }));
    }
  },
  updateConversationList: (
    list: ConversationItem[],
    type: ConversationListUpdateType,
  ) => {
    const idx = list.findIndex(
      (c) => c.conversationID === get().currentConversation?.conversationID,
    );
    if (idx > -1) get().updateCurrentConversation(list[idx]);

    if (type === "filter") {
      set((state) => ({
        conversationList: conversationSort([...list, ...state.conversationList]),
      }));
      return;
    }
    let filterArr: ConversationItem[] = [];
    const chids = list.map((ch) => ch.conversationID);
    filterArr = get().conversationList.filter(
      (tc) => !chids.includes(tc.conversationID),
    );

    set(() => ({ conversationList: conversationSort([...list, ...filterArr]) }));
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
  getUnReadCountByReq: async () => {
    try {
      const { data } = await IMSDK.getTotalUnreadMsgCount();
      set(() => ({ unReadCount: data }));
      return data;
    } catch (error) {
      console.error(error);
      return 0;
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
      currentConversation: undefined,
      unReadCount: 0,
      currentGroupInfo: undefined,
      currentMemberInGroup: undefined,
      currentMemberInGroupLoading: false,
      quoteMessage: undefined,
      localLoadedCount: 0,
      localExhausted: false,
      remoteLoadedCount: 0,
      remoteHasMore: true,
      remoteLoading: false,
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
