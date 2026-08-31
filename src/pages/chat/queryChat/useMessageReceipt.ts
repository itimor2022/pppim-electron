import { CbEvents } from "open-im-sdk-wasm";
import { SessionType } from "open-im-sdk-wasm";
import {
  GroupMessageReceiptInfo,
  ReceiptInfo,
  WSEvent,
} from "open-im-sdk-wasm/lib/types/entity";
import { useEffect } from "react";

import { IMSDK } from "@/layout/MainContentWrap";
import {
  ExMessageItem,
  useConversationStore,
  useMessageStore,
  useUserStore,
} from "@/store";

export function useMessageReceipt() {
  const selfUserID = useUserStore((state) => state.selfInfo.userID);
  const updateMessages = useMessageStore((state) => state.updateMessages);

  useEffect(() => {
    setIMListener();
    return () => {
      disposeIMListener();
    };
  }, [selfUserID]);

  const setIMListener = () => {
    IMSDK.on(CbEvents.OnRecvC2CReadReceipt, singleMessageHasReadedHander);
    IMSDK.on(CbEvents.OnRecvGroupReadReceipt, groupMessageHasReadedHander);
  };

  const disposeIMListener = () => {
    IMSDK.off(CbEvents.OnRecvC2CReadReceipt, singleMessageHasReadedHander);
    IMSDK.off(CbEvents.OnRecvGroupReadReceipt, groupMessageHasReadedHander);
  };

  const singleMessageHasReadedHander = ({ data }: WSEvent<ReceiptInfo[]>) => {
    if (
      useConversationStore.getState().currentConversation?.conversationType !==
      SessionType.Single
    )
      return;

    const updates = data.flatMap((receipt) =>
      (receipt.msgIDList ?? []).map(
        (clientMsgID: string) =>
          ({
            clientMsgID,
            isRead: true,
          } as ExMessageItem),
      ),
    );
    updateMessages(updates);
  };

  const groupMessageHasReadedHander = ({ data }: WSEvent<GroupMessageReceiptInfo>) => {
    if (
      useConversationStore.getState().currentConversation?.conversationID !==
      data.conversationID
    )
      return;

    const currentMessageMap = new Map(
      useMessageStore
        .getState()
        .historyMessageList.map((message) => [message.clientMsgID, message]),
    );
    const updates = data.groupMessageReadInfo.map((receipt) => {
      const hasSelfRead = receipt.readMembers?.some(
        (member) => member.userID === selfUserID,
      );
      const oldMessage = currentMessageMap.get(receipt.clientMsgID);
      return {
        ...oldMessage,
        clientMsgID: receipt.clientMsgID,
        isRead: hasSelfRead ? true : oldMessage?.isRead,
        attachedInfoElem: {
          ...oldMessage?.attachedInfoElem,
          groupHasReadInfo: {
            hasReadCount: receipt.hasReadCount,
            unreadCount: receipt.unreadCount,
          },
        },
      } as ExMessageItem;
    });
    updateMessages(updates);
  };
}
