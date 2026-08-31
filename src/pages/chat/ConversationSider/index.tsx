import { LoadingOutlined } from "@ant-design/icons";
import { t } from "i18next";
import { ConversationItem } from "open-im-sdk-wasm/lib/types/entity";
import { useEffect, useRef } from "react";
import { useMatches } from "react-router-dom";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";

import FlexibleSider from "@/components/FlexibleSider";
import { useConversationStore } from "@/store";
import emitter from "@/utils/events";

import styles from "./conversation-sider.module.scss";
import ConversationItemComp from "./ConversationItem";

function getNextUnreadIndex(
  conversationList: ConversationItem[],
  currentIndex: number,
) {
  let nextIndex = currentIndex + 1;
  let count = 0;
  while (count < conversationList.length) {
    if (nextIndex >= conversationList.length) {
      nextIndex = 0;
    }
    if (conversationList[nextIndex].unreadCount > 0) {
      return nextIndex;
    }
    nextIndex++;
    count++;
  }
  return -1;
}

const ConversationSider = () => {
  const matches = useMatches();
  const conversationList = useConversationStore((state) => state.conversationList);
  const isSyncing = useConversationStore((state) => state.isSyncing);
  const getConversationListByReq = useConversationStore(
    (state) => state.getConversationListByReq,
  );
  const virtuoso = useRef<VirtuosoHandle>(null);
  const hasmore = useRef(true);
  const loadingMore = useRef(false);
  const currentIndex = useRef(0);

  const inConversation = Boolean(matches[matches.length - 1].params.conversationID);

  useEffect(() => {
    const scrollToUnread = () => {
      currentIndex.current = getNextUnreadIndex(
        useConversationStore.getState().conversationList,
        currentIndex.current,
      );
      if (currentIndex.current > -1) {
        virtuoso.current?.scrollToIndex({
          index: currentIndex.current,
          behavior: "smooth",
        });
      }
    };
    emitter.on("TRY_JUMP_TO_UNREAD", scrollToUnread);
    return () => {
      emitter.off("TRY_JUMP_TO_UNREAD", scrollToUnread);
    };
  }, []);

  const endReached = async () => {
    if (!hasmore.current || loadingMore.current) return;
    loadingMore.current = true;
    try {
      hasmore.current = await getConversationListByReq(true);
    } finally {
      loadingMore.current = false;
    }
  };

  return (
    <FlexibleSider
      needHidden={inConversation}
      wrapClassName={`left-2 right-2 top-3 ${styles.wrap}`}
    >
      {isSyncing && (
        <div className={styles.syncStatus} role="status" aria-live="polite">
          <div className={styles.syncStatusText}>
            <LoadingOutlined spin />
            <span>{t("toast.syncing")}</span>
          </div>
          <div className={styles.syncProgress} aria-hidden="true">
            <div className={styles.syncProgressBar}></div>
          </div>
        </div>
      )}
      <Virtuoso
        className={styles.list}
        data={conversationList}
        ref={virtuoso}
        endReached={endReached}
        computeItemKey={(_, item) => item.conversationID}
        itemContent={(_, conversation) => (
          <ConversationItemComp conversation={conversation} />
        )}
      />
    </FlexibleSider>
  );
};

export default ConversationSider;
