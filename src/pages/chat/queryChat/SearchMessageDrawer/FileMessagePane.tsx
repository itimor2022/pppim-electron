import { useLatest } from "ahooks";
import { Empty, Spin } from "antd";
import { t } from "i18next";
import { MessageType } from "open-im-sdk-wasm";
import { memo, useEffect, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";

import file_icon from "@/assets/images/messageItem/file_icon.png";
import {
  getSourceData,
  useMessageFileDownloadState,
} from "@/hooks/useMessageFileDownloadState";
import { IMSDK } from "@/layout/MainContentWrap";
import ViewFileInFinder from "@/pages/common/GlobalSearchModal/ViewFileInFinder";
import { ExMessageItem, useConversationStore, useMessageStore } from "@/store";
import FileDownloadIcon from "@/svg/FileDownloadIcon";
import { bytesToSize, feedbackToast } from "@/utils/common";
import { formatMessageTime } from "@/utils/imCommon";
import { scheduleIMSDKRequest } from "@/utils/imSdkRequestScheduler";

import MessageSearchBar from "./MessageSearchBar";

const initialData = {
  loading: false,
  hasMore: true,
  pageIndex: 1,
  messageList: [] as ExMessageItem[],
};

const FileMessagePane = ({
  isActive,
  conversationID,
  isOverlayOpen,
}: {
  isActive: boolean;
  conversationID?: string;
  isOverlayOpen: boolean;
}) => {
  const loadMoreKeyword = useRef("");
  const inputRef = useRef<{ clear: () => void }>(null);
  const searchGeneration = useRef(0);
  const isActiveRef = useRef(isActive);
  const isOverlayOpenRef = useRef(isOverlayOpen);
  isActiveRef.current = isActive;
  isOverlayOpenRef.current = isOverlayOpen;
  const [loadState, setLoadState] = useState({
    ...initialData,
  });
  const latestLoadState = useLatest(loadState);

  useEffect(() => {
    const downloadSuccessHandler = (url: string, filePath: string) => {
      const task = useMessageStore.getState().downloadMap[url];
      if (!task) return;
      const { clientMsgID } = task;

      const index =
        latestLoadState.current?.messageList.findIndex(
          (message) => message.clientMsgID === clientMsgID,
        ) ?? -1;
      if (index > -1) {
        setLoadState((state) => {
          const tmpMessage = [...state.messageList];
          tmpMessage[index].localEx = filePath;
          return {
            ...state,
            messageList: tmpMessage,
          };
        });
      }
    };

    const unsubscribeSuccess = window.electronAPI?.subscribe(
      "downloadSuccess",
      downloadSuccessHandler,
    );

    return () => {
      unsubscribeSuccess?.();
    };
  }, []);

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

  useEffect(() => {
    if (isActive) {
      triggerSearch("");
    }
  }, [isActive]);

  const triggerSearch = async (keyword: string, loadMore = false) => {
    if (
      (!loadState.hasMore && loadMore) ||
      (loadState.loading && loadMore) ||
      !conversationID ||
      !isActive ||
      !isOverlayOpen
    )
      return;
    const generation = loadMore ? searchGeneration.current : ++searchGeneration.current;
    const requestPageIndex = loadMore ? loadState.pageIndex : 1;
    loadMoreKeyword.current = keyword;
    setLoadState((state) =>
      loadMore ? { ...state, loading: true } : { ...initialData, loading: true },
    );

    try {
      const response = await scheduleIMSDKRequest(
        () =>
          IMSDK.searchLocalMessages({
            conversationID,
            keywordList: [keyword],
            keywordListMatchType: 0,
            senderUserIDList: [],
            messageTypeList: [MessageType.FileMessage],
            searchTimePosition: 0,
            searchTimePeriod: 0,
            pageIndex: requestPageIndex,
            count: 20,
          }),
        {
          priority: "low",
          isValid: () =>
            generation === searchGeneration.current &&
            isActiveRef.current &&
            isOverlayOpenRef.current &&
            useConversationStore.getState().currentConversation?.conversationID ===
              conversationID,
        },
      );
      if (
        !response ||
        generation !== searchGeneration.current ||
        !isActiveRef.current ||
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
      <div className="my-2 flex-1 px-2.5">
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
          itemContent={(_, message) => <FileMessageItem message={message} />}
        />
      </div>
    </div>
  );
};

export default memo(FileMessagePane);

const FileMessageItem = memo(({ message }: { message: ExMessageItem }) => {
  const { fileElem } = message;

  const { progress, downloadState, tryDownload } = useMessageFileDownloadState(message);

  const viewInFinder = () => {
    const path = message.localEx || getSourceData(message).path;
    if (path) {
      window.electronAPI?.showInFinder(path);
    }
  };

  return (
    <ViewFileInFinder viewInFinder={viewInFinder}>
      <div
        className="flex cursor-pointer items-center justify-between rounded-md px-3 py-2.5 hover:bg-[var(--primary-active)]"
        onClick={tryDownload}
      >
        <div className="flex items-center">
          <div className="relative">
            <img width={38} src={file_icon} alt="file" />
            {downloadState !== "finish" && (
              <div className="absolute left-0 top-0 flex h-full w-full items-center justify-center rounded-md bg-[rgba(0,0,0,.4)]">
                <FileDownloadIcon
                  pausing={downloadState === "pause"}
                  percent={progress ?? 0}
                />
              </div>
            )}
          </div>
          <div className="ml-3">
            <div>{fileElem.fileName}</div>
            <div className="mt-2 flex items-center text-xs">
              <div>{bytesToSize(fileElem.fileSize)}</div>
              <div className="ml-3.5 mr-2 max-w-[120px] truncate text-[var(--sub-text)]">
                {message.senderNickname}
              </div>
              <div className="text-[var(--sub-text)]">
                {formatMessageTime(message.sendTime)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </ViewFileInFinder>
  );
});
