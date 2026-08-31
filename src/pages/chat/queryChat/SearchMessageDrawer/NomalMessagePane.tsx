import { Empty, Spin } from "antd";
import { t } from "i18next";
import { MessageType } from "open-im-sdk-wasm";
import { FC, useEffect, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";

import JumpToMessageWrap from "@/components/JumpToMessageWrap";
import OIMAvatar from "@/components/OIMAvatar";
import { canSearchMessageTypes } from "@/constants";
import { IMSDK } from "@/layout/MainContentWrap";
import { ExMessageItem, useConversationStore } from "@/store";
import { feedbackToast } from "@/utils/common";
import { formatMessageTime } from "@/utils/imCommon";
import { scheduleIMSDKRequest } from "@/utils/imSdkRequestScheduler";

import { IMessageItemProps } from "../MessageItem";
import CardMessageRenderer from "../MessageItem/CardMessageRenderer";
import CatchMessageRender from "../MessageItem/CatchMsgRenderer";
import CustomMessageSwitcher from "../MessageItem/CustomMessageSwitcher";
import FileMessageRenderer from "../MessageItem/FileMessageRenderer";
import LocationMessageRenderer from "../MessageItem/LocationMessageRenderer";
import MediaMessageRender from "../MessageItem/MediaMessageRender";
import TextMessageRender from "../MessageItem/TextMessageRender";
import VoiceMessageRender from "../MessageItem/VoiceMessageRender";
import MessageSearchBar from "./MessageSearchBar";

const initialData = {
  loading: false,
  hasMore: true,
  pageIndex: 1,
  messageList: [] as ExMessageItem[],
};

const NomalMessagePane = ({
  conversationID,
  isOverlayOpen,
  closeOverlay,
}: {
  conversationID?: string;
  isOverlayOpen: boolean;
  closeOverlay: () => void;
}) => {
  const loadMoreKeyword = useRef("");
  const inputRef = useRef<{ clear: () => void }>(null);
  const searchGeneration = useRef(0);
  const isOverlayOpenRef = useRef(isOverlayOpen);
  isOverlayOpenRef.current = isOverlayOpen;
  const [loadState, setLoadState] = useState({ ...initialData });

  useEffect(() => {
    searchGeneration.current += 1;
    setLoadState({ ...initialData });
    inputRef.current?.clear();
  }, [conversationID]);

  useEffect(() => {
    if (isOverlayOpen) return;
    searchGeneration.current += 1;
    setLoadState({ ...initialData });
    inputRef.current?.clear();
  }, [isOverlayOpen]);

  const triggerSearch = async (keyword: string, loadMore = false) => {
    const normalizedKeyword = keyword.trim();
    if (!normalizedKeyword) {
      searchGeneration.current += 1;
      loadMoreKeyword.current = "";
      setLoadState({ ...initialData });
      return;
    }
    if (
      (!loadState.hasMore && loadMore) ||
      (loadState.loading && loadMore) ||
      !conversationID ||
      !isOverlayOpen
    )
      return;
    const generation = loadMore ? searchGeneration.current : ++searchGeneration.current;
    const requestPageIndex = loadMore ? loadState.pageIndex : 1;
    loadMoreKeyword.current = normalizedKeyword;
    setLoadState((state) =>
      loadMore ? { ...state, loading: true } : { ...initialData, loading: true },
    );

    try {
      const response = await scheduleIMSDKRequest(
        () =>
          IMSDK.searchLocalMessages({
            conversationID,
            keywordList: [normalizedKeyword],
            keywordListMatchType: 0,
            senderUserIDList: [],
            messageTypeList: canSearchMessageTypes,
            searchTimePosition: 0,
            searchTimePeriod: 0,
            pageIndex: requestPageIndex,
            count: 20,
          }),
        {
          priority: "low",
          isValid: () =>
            generation === searchGeneration.current &&
            isOverlayOpenRef.current &&
            useConversationStore.getState().currentConversation?.conversationID ===
              conversationID,
        },
      );
      if (
        !response ||
        generation !== searchGeneration.current ||
        !isOverlayOpenRef.current ||
        useConversationStore.getState().currentConversation?.conversationID !==
          conversationID
      )
        return;
      const searchData: ExMessageItem[] =
        response.data.searchResultItems?.[0]?.messageList ?? [];
      setLoadState((state) => ({
        loading: false,
        pageIndex: requestPageIndex + 1,
        hasMore: searchData.length === 20,
        messageList: [...(!loadMore ? [] : state.messageList), ...searchData],
      }));
    } catch (error) {
      if (generation !== searchGeneration.current) return;
      setLoadState((state) => ({ ...state, loading: false }));
      feedbackToast({ error, msg: t("toast.getMessageListFailed") });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <MessageSearchBar ref={inputRef} triggerSearch={triggerSearch} />
      <div className="m-2 flex-1">
        <Virtuoso
          className="h-full overflow-x-hidden"
          data={loadState.messageList}
          endReached={() => triggerSearch(loadMoreKeyword.current, true)}
          components={{
            EmptyPlaceholder: () =>
              loadState.loading ? null : (
                <Empty
                  className="flex h-full flex-col items-center justify-center"
                  description={t("empty.noSearchResults")}
                />
              ),
            Footer: () =>
              loadState.loading ? (
                <div className="flex w-full justify-center py-3">
                  <Spin spinning />
                </div>
              ) : null,
          }}
          itemContent={(_, message) => (
            <NomalMessageItem
              message={message}
              conversationID={conversationID}
              closeOverlay={closeOverlay}
            />
          )}
        />
      </div>
    </div>
  );
};

export default NomalMessagePane;

const components: Record<number, FC<IMessageItemProps>> = {
  [MessageType.TextMessage]: TextMessageRender,
  [MessageType.AtTextMessage]: TextMessageRender,
  [MessageType.QuoteMessage]: TextMessageRender,
  [MessageType.VoiceMessage]: VoiceMessageRender,
  [MessageType.PictureMessage]: MediaMessageRender,
  [MessageType.VideoMessage]: MediaMessageRender,
  [MessageType.CardMessage]: CardMessageRenderer,
  [MessageType.FileMessage]: FileMessageRenderer,
  [MessageType.LocationMessage]: LocationMessageRenderer,
  [MessageType.CustomMessage]: CustomMessageSwitcher,
};

export const NomalMessageItem = ({
  message,
  conversationID,
  closeOverlay,
}: {
  message: ExMessageItem;
  conversationID?: string;
  closeOverlay: () => void;
}) => {
  const jumpWrapRef = useRef<{ jumpToHistory: () => Promise<void> }>(null);

  const MessageRenderComponent = components[message.contentType] || CatchMessageRender;

  return (
    <JumpToMessageWrap
      ref={jumpWrapRef}
      message={message}
      conversationID={conversationID!}
      afterJump={closeOverlay}
    >
      <div
        className="flex items-start rounded-md px-3.5 py-3 hover:bg-[var(--primary-active)]"
        onDoubleClick={() => jumpWrapRef.current?.jumpToHistory()}
      >
        <OIMAvatar src={message.senderFaceUrl} text={message.senderNickname} />
        <div className="ml-3 flex-1 select-text">
          <div className="mb-1 flex items-center text-xs">
            <div
              title={message.senderNickname}
              className="max-w-[30%] truncate text-[var(--sub-text)]"
            >
              {message.senderNickname}
            </div>
            <div className="ml-2 text-[var(--sub-text)]">
              {formatMessageTime(message.sendTime)}
            </div>
          </div>
          <MessageRenderComponent disabled message={message} isSender={false} />
          {/* <div>{formatMessageByType(message)}</div> */}
        </div>
      </div>
    </JumpToMessageWrap>
  );
};
