import { InfoCircleOutlined } from "@ant-design/icons";
import { useRequest, useUnmount } from "ahooks";
import { Layout, Spin } from "antd";
import { t } from "i18next";
import { SessionType } from "open-im-sdk-wasm";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { IMSDK } from "@/layout/MainContentWrap";
import { useConversationStore, useMessageStore } from "@/store";
import emitter from "@/utils/events";

import ChatContent from "./ChatContent";
import ChatFooter from "./ChatFooter";
import MultipleActionBar from "./ChatFooter/MultipleActionBar";
import ChatHeader from "./ChatHeader";
import useConversationState from "./useConversationState";
import { useDropAndPaste } from "./useDropAndPaste";
import { useMessageReceipt } from "./useMessageReceipt";

const INITIAL_HISTORY_RETRY_DELAYS_MS = [500, 1_500, 3_000];

export const QueryChat = () => {
  const { conversationID } = useParams();
  const isCheckMode = useMessageStore((state) => state.isCheckMode);
  const jumpLoading = useMessageStore((state) => state.jumpLoading);
  const updateCheckMode = useMessageStore((state) => state.updateCheckMode);
  const updateCurrentConversation = useConversationStore(
    (state) => state.updateCurrentConversation,
  );
  const updateQuoteMessage = useConversationStore((state) => state.updateQuoteMessage);
  const getHistoryMessageList = useMessageStore(
    (state) => state.getHistoryMessageListByReq,
  );
  const clearHistoryMessage = useMessageStore((state) => state.clearHistoryMessage);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadedConversationID, setLoadedConversationID] = useState<string>();
  const loadGeneration = useRef(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>();

  const {
    loading,
    runAsync: initMessages,
    cancel,
  } = useRequest(getHistoryMessageList, {
    manual: true,
  });

  const {
    getIsCanSendMessage,
    isMutedGroup,
    currentIsMuted,
    currentConversation,
    currentMemberInGroupLoading,
  } = useConversationState();
  useMessageReceipt();

  const isNotificationSession =
    currentConversation?.conversationType === SessionType.Notification;
  const isConversationMatched =
    Boolean(conversationID) && currentConversation?.conversationID === conversationID;
  const isConversationLoading =
    initialLoading || loadedConversationID !== conversationID || !isConversationMatched;
  const canSendMessage = isConversationMatched && getIsCanSendMessage();

  const { droping } = useDropAndPaste({
    currentConversation,
    getIsCanSendMessage: () => isConversationMatched && getIsCanSendMessage(),
  });

  useEffect(() => {
    const generation = ++loadGeneration.current;
    setInitialLoading(true);
    let initialHistoryLoaded = false;
    let initialHistoryRequestPending = false;
    let historyRecoveryAttempt = 0;

    const isCurrentConversationLoad = () =>
      generation === loadGeneration.current &&
      useConversationStore.getState().currentConversation?.conversationID ===
        conversationID;

    const settleInitialHistory = () => {
      if (!isCurrentConversationLoad()) return;
      setLoadedConversationID(conversationID);
      setInitialLoading(false);
    };

    const scheduleHistoryRecovery = () => {
      if (initialHistoryLoaded || refreshTimer.current) return;
      const retryDelay = INITIAL_HISTORY_RETRY_DELAYS_MS[historyRecoveryAttempt];
      if (retryDelay === undefined) {
        settleInitialHistory();
        return;
      }
      historyRecoveryAttempt += 1;
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = undefined;
        void loadInitialMessages();
      }, retryDelay);
    };

    const loadInitialMessages = async () => {
      if (initialHistoryRequestPending || !isCurrentConversationLoad()) return;
      initialHistoryRequestPending = true;
      const loaded = await initMessages().catch(() => false);
      initialHistoryRequestPending = false;
      if (!isCurrentConversationLoad()) return;
      if (loaded === true) {
        initialHistoryLoaded = true;
        settleInitialHistory();
        return;
      }
      scheduleHistoryRecovery();
    };

    const refresh = () => {
      if (initialHistoryRequestPending || initialHistoryLoaded) return;
      scheduleHistoryRecovery();
    };
    emitter.on("REFRESH_CHAT_LIST", refresh);
    if (useMessageStore.getState().jumpClientMsgID) {
      settleInitialHistory();
    } else {
      void loadInitialMessages();
    }
    return () => {
      loadGeneration.current += 1;
      emitter.off("REFRESH_CHAT_LIST", refresh);
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
        refreshTimer.current = undefined;
      }
      cancel();
      updateCheckMode(false);
      updateQuoteMessage();
      if (!useMessageStore.getState().jumpClientMsgID) {
        clearHistoryMessage();
      }
    };
  }, [conversationID]);

  useUnmount(() => {
    updateCurrentConversation();
  });

  useEffect(() => {
    if (
      !isConversationMatched ||
      isNotificationSession ||
      isCheckMode ||
      canSendMessage ||
      currentMemberInGroupLoading ||
      !currentConversation?.draftText
    ) {
      return;
    }

    void IMSDK.setConversationDraft({
      conversationID: currentConversation.conversationID,
      draftText: "",
    }).catch((error) => {
      console.error("clear unavailable conversation draft failed", error);
    });
  }, [
    canSendMessage,
    currentConversation?.conversationID,
    currentConversation?.draftText,
    currentMemberInGroupLoading,
    isCheckMode,
    isConversationMatched,
    isNotificationSession,
  ]);

  const switchFooter = () => {
    if (!isConversationMatched || isNotificationSession) {
      return null;
    }
    if (isCheckMode) {
      return <MultipleActionBar />;
    }
    if (!canSendMessage) {
      let tip = t("toast.notCanSendMessage");
      if (currentMemberInGroupLoading) tip = t("toast.groupMemberSyncing");
      if (isMutedGroup) tip = t("toast.groupMuted");
      if (currentIsMuted) tip = t("toast.currentMuted");

      return (
        <div className="flex justify-center py-4.5 text-xs text-[var(--sub-text)]">
          <InfoCircleOutlined rev={undefined} />
          <span className="ml-1">{tip}</span>
        </div>
      );
    }
    return <ChatFooter key={conversationID} />;
  };

  return (
    <Layout id="chat-container" className="relative overflow-hidden">
      <ChatHeader />
      {isConversationLoading || loading || jumpLoading ? (
        <div className="flex h-full items-center justify-center bg-white pt-1">
          <Spin spinning />
        </div>
      ) : (
        <ChatContent isNotificationSession={isNotificationSession} />
      )}
      {switchFooter()}
      {droping && (
        <div className="absolute left-0 top-0 flex h-full w-full items-center justify-center bg-[rgba(248,229,229,0.4)]">
          <div className="max-w-[200px] truncate text-[var(--sub-text)]">{`${t(
            "placeholder.loosenToSend",
          )} ${currentConversation?.showName}`}</div>
        </div>
      )}
    </Layout>
  );
};
