import { useRequest, useThrottleFn } from "ahooks";
import { GroupAtType, GroupStatus } from "open-im-sdk-wasm";
import { useEffect, useState } from "react";

import { useCurrentMemberRole } from "@/hooks/useCurrentMemberRole";
import { IMSDK } from "@/layout/MainContentWrap";
import { useConversationStore } from "@/store";

export default function useConversationState() {
  const currentConversation = useConversationStore(
    (state) => state.currentConversation,
  );
  const isMutedGroup = useConversationStore(
    (state) => state.currentGroupInfo?.status === GroupStatus.Muted,
  );
  const currentMemberInGroupLoading = useConversationStore(
    (state) => state.currentMemberInGroupLoading,
  );

  const { isJoinGroup, isNomal, currentIsMuted } = useCurrentMemberRole();

  useEffect(() => {
    checkConversationState();
    return () => {
      checkConversationState();
    };
  }, [
    currentConversation?.conversationID,
    currentConversation?.groupAtType,
    currentConversation?.unreadCount,
  ]);

  const { run: checkConversationState } = useThrottleFn(
    () => {
      if (!currentConversation) return;

      if (currentConversation.unreadCount > 0) {
        IMSDK.markConversationMessageAsRead(currentConversation.conversationID);
      }
      if (
        currentConversation.groupAtType !== GroupAtType.AtNormal &&
        currentConversation.groupAtType !== GroupAtType.AtGroupNotice
      ) {
        IMSDK.resetConversationGroupAtType(currentConversation.conversationID);
      }
    },
    { wait: 2000 },
  );

  const getIsCanSendMessage = () => {
    if (currentConversation?.userID) {
      return true;
    }

    if (currentMemberInGroupLoading) {
      return false;
    }

    if (!isJoinGroup) {
      return false;
    }

    if (isMutedGroup && isNomal) {
      return false;
    }

    return !currentIsMuted;
  };

  return {
    getIsCanSendMessage,
    currentIsMuted,
    isMutedGroup,
    currentConversation,
    currentMemberInGroupLoading,
  };
}
