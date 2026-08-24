import type { SessionType } from "open-im-sdk-wasm";
import { ConversationItem } from "open-im-sdk-wasm/lib/types/entity";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import { IMSDK } from "@/layout/MainContentWrap";
import { useConversationStore } from "@/store";
import { feedbackToast } from "@/utils/common";

export function useConversationToggle() {
  const navigate = useNavigate();
  const updateCurrentConversation = useConversationStore(
    (state) => state.updateCurrentConversation,
  );

  const getConversation = async ({
    sourceID,
    sessionType,
  }: {
    sourceID: string;
    sessionType: SessionType;
  }): Promise<ConversationItem | undefined> => {
    // 排除仅存在于服务端分页结果中的会话(onlyRemote), 其必须先经
    // getOneConversation 同步进 SDK 本地库才能正常进入聊天
    let conversation = useConversationStore
      .getState()
      .conversationList.find(
        (item) =>
          !(item as { onlyRemote?: boolean }).onlyRemote &&
          (item.userID === sourceID || item.groupID === sourceID),
      );
    if (!conversation) {
      try {
        conversation = (
          await IMSDK.getOneConversation({
            sourceID,
            sessionType,
          })
        ).data;
      } catch (error) {
        feedbackToast({ error });
      }
    }
    return conversation;
  };

  const toSpecifiedConversation = useCallback(
    async (
      data: {
        sourceID: string;
        sessionType: SessionType;
      },
      isJump?: boolean,
    ) => {
      const conversation = await getConversation(data);
      if (
        !conversation ||
        useConversationStore.getState().currentConversation?.conversationID ===
          conversation.conversationID
      )
        return;
      updateCurrentConversation({ ...conversation }, isJump);
      navigate(`/chat/${conversation.conversationID}`);
    },
    [],
  );

  return {
    toSpecifiedConversation,
  };
}
