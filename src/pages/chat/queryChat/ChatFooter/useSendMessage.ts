import { MessageStatus, MessageType } from "open-im-sdk-wasm";
import { ConversationItem } from "open-im-sdk-wasm/lib/types/entity";
import { SendMsgParams } from "open-im-sdk-wasm/lib/types/params";
import { useCallback } from "react";

import { IMSDK } from "@/layout/MainContentWrap";
import { ExMessageItem, useConversationStore, useMessageStore } from "@/store";
import { feedbackToast } from "@/utils/common";
import emitter from "@/utils/events";

const shouldReplaceLatestMessage = (
  currentConversation: ConversationItem,
  nextLatestMsg: string,
  nextLatestMsgSendTime: number,
) => {
  try {
    const currentMessage = JSON.parse(currentConversation.latestMsg) as ExMessageItem;
    const nextMessage = JSON.parse(nextLatestMsg) as ExMessageItem;
    if (currentMessage.clientMsgID === nextMessage.clientMsgID) {
      return true;
    }
  } catch {
    // Fall through to timestamp comparison when either latest message is invalid.
  }
  if (nextLatestMsgSendTime !== currentConversation.latestMsgSendTime) {
    return nextLatestMsgSendTime > currentConversation.latestMsgSendTime;
  }
  try {
    const currentMessage = JSON.parse(currentConversation.latestMsg) as ExMessageItem;
    const nextMessage = JSON.parse(nextLatestMsg) as ExMessageItem;
    if (currentMessage.seq > 0 && nextMessage.seq > 0) {
      return nextMessage.seq > currentMessage.seq;
    }
  } catch {
    return false;
  }
  return true;
};

const mergeVideoSnapshotFallback = (
  localMessage: ExMessageItem,
  successMessage: ExMessageItem,
) => {
  if (
    localMessage.contentType !== MessageType.VideoMessage ||
    successMessage.contentType !== MessageType.VideoMessage
  ) {
    return successMessage;
  }

  const localVideoElem = localMessage.videoElem;
  const successVideoElem = successMessage.videoElem;

  return {
    ...successMessage,
    videoElem: {
      ...successVideoElem,
      snapshotPath: successVideoElem.snapshotPath || localVideoElem.snapshotPath,
      snapshotUrl: successVideoElem.snapshotUrl || localVideoElem.snapshotUrl,
      snapshotWidth: successVideoElem.snapshotWidth || localVideoElem.snapshotWidth,
      snapshotHeight: successVideoElem.snapshotHeight || localVideoElem.snapshotHeight,
      snapshotUUID: successVideoElem.snapshotUUID || localVideoElem.snapshotUUID,
      snapshotSize: successVideoElem.snapshotSize || localVideoElem.snapshotSize,
    },
  };
};

const mergeSentMessageFallback = (
  localMessage: ExMessageItem,
  sdkMessage: unknown,
): ExMessageItem => {
  const successMessage =
    sdkMessage && typeof sdkMessage === "object"
      ? (sdkMessage as Partial<ExMessageItem>)
      : {};

  if (successMessage.contentType !== localMessage.contentType) {
    console.error("invalid sent message returned by SDK", {
      clientMsgID: localMessage.clientMsgID,
      localContentType: localMessage.contentType,
      sdkContentType: successMessage.contentType,
    });
  }

  const mergedMessage = {
    ...localMessage,
    ...successMessage,
    contentType: localMessage.contentType,
  } as ExMessageItem;

  if (localMessage.contentType === MessageType.TextMessage) {
    mergedMessage.textElem = successMessage.textElem ?? localMessage.textElem;
  } else if (localMessage.contentType === MessageType.AtTextMessage) {
    mergedMessage.atTextElem = successMessage.atTextElem ?? localMessage.atTextElem;
  } else if (localMessage.contentType === MessageType.QuoteMessage) {
    mergedMessage.quoteElem = successMessage.quoteElem ?? localMessage.quoteElem;
  }

  return mergeVideoSnapshotFallback(localMessage, mergedMessage);
};

export type SendMessageParams = Partial<Omit<SendMsgParams, "message">> & {
  message: ExMessageItem;
  needPush?: boolean;
  isResend?: boolean;
};

export function useSendMessage() {
  const pushNewMessage = useMessageStore((state) => state.pushNewMessage);
  const tryAddPreviewImg = useMessageStore((state) => state.tryAddPreviewImg);
  const updateOneMessage = useMessageStore((state) => state.updateOneMessage);
  const deleteAndPushOneMessage = useMessageStore(
    (state) => state.deleteAndPushOneMessage,
  );

  const sendMessage = useCallback(
    async ({ recvID, groupID, message, needPush, isResend }: SendMessageParams) => {
      const currentConversation = useConversationStore.getState().currentConversation;
      const sourceID = recvID || groupID;
      const inCurrentConversation =
        currentConversation?.userID === sourceID ||
        currentConversation?.groupID === sourceID ||
        !sourceID;
      needPush = needPush ?? inCurrentConversation;

      if (needPush) {
        pushNewMessage(message);
        emitter.emit("CHAT_LIST_SCROLL_TO_BOTTOM", true);
      }

      const options = {
        recvID: recvID ?? currentConversation?.userID ?? "",
        groupID: groupID ?? currentConversation?.groupID ?? "",
        message,
      };

      const updateConversationLatest = (latestMessage: ExMessageItem) => {
        const conversationStore = useConversationStore.getState();
        const latestGroupID = latestMessage.groupID || groupID;
        const latestSourceID =
          latestGroupID ||
          (latestMessage.sendID === recvID
            ? latestMessage.sendID
            : recvID || latestMessage.recvID);
        const targetConversation = latestSourceID
          ? conversationStore.conversationList.find((conversation) =>
              latestGroupID
                ? conversation.groupID === latestSourceID
                : conversation.userID === latestSourceID,
            )
          : undefined;
        if (!targetConversation) return;

        const latestMsg = JSON.stringify(latestMessage);
        const latestMsgSendTime = latestMessage.sendTime || Date.now();
        if (
          !shouldReplaceLatestMessage(targetConversation, latestMsg, latestMsgSendTime)
        ) {
          return;
        }
        conversationStore.updateConversationList(
          [
            {
              ...targetConversation,
              draftText: "",
              latestMsg,
              latestMsgSendTime,
            },
          ],
          "filter",
        );
      };

      updateConversationLatest(message);

      try {
        const { data: successMessage } = await IMSDK.sendMessage(options);
        const mergedSuccessMessage = mergeSentMessageFallback(message, successMessage);
        updateConversationLatest(mergedSuccessMessage);
        if (isResend) {
          deleteAndPushOneMessage(mergedSuccessMessage);
          return;
        }
        updateOneMessage(mergedSuccessMessage);
        tryAddPreviewImg([mergedSuccessMessage]);
      } catch (error) {
        const failedMessage = {
          ...message,
          status: MessageStatus.Failed,
        };
        updateOneMessage(failedMessage);
        updateConversationLatest(failedMessage);
        if ((error as { errCode?: number; message?: string })?.errCode === 20013) {
          feedbackToast({ error });
        }
      }
    },
    [],
  );

  return {
    sendMessage,
    updateOneMessage,
  };
}
