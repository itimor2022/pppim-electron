import { useLatest } from "ahooks";
import { Empty, Image } from "antd";
import clsx from "clsx";
import { isThisMonth, isThisWeek } from "date-fns";
import { t } from "i18next";
import { MessageType } from "open-im-sdk-wasm";
import {
  forwardRef,
  ForwardRefRenderFunction,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Virtuoso } from "react-virtuoso";

import CacheImage from "@/components/CacheImage";
import PreviewToolsBar from "@/components/PreviewToolsBar";
import { useMessageFileDownloadState } from "@/hooks/useMessageFileDownloadState";
import { IMSDK } from "@/layout/MainContentWrap";
import {
  ExMessageItem,
  getImageMessageSourceUrl,
  useConversationStore,
  useMessageStore,
  useUserStore,
} from "@/store";
import { PreviewGroupItem } from "@/store/type";
import FileDownloadIcon from "@/svg/FileDownloadIcon";
import { downloadFile, feedbackToast, getDownloadTask } from "@/utils/common";
import emitter from "@/utils/events";
import { scheduleIMSDKRequest } from "@/utils/imSdkRequestScheduler";

const MediaMessagePane = ({
  isVideo,
  isActive,
  conversationID,
}: {
  isVideo?: boolean;
  isActive: boolean;
  conversationID?: string;
}) => {
  const [loadState, setLoadState] = useState({
    loading: false,
    hasMore: true,
    pageIndex: 1,
    weekMessage: [] as ExMessageItem[],
    monthMessage: [] as ExMessageItem[],
    earlierMessage: [] as ExMessageItem[],
    previewItems: [] as PreviewGroupItem[],
  });
  const latestLoadState = useLatest(loadState);
  const searchGeneration = useRef(0);
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  const galleryRef = useRef<{
    setAlbumCurrent: (current: number) => void;
    setAlbumVisible: (visible: boolean) => void;
  }>(null);

  useEffect(() => {
    const downloadSuccessHandler = (url: string, filePath: string) => {
      const task = useMessageStore.getState().downloadMap[url];
      if (!task) return;
      const { isMediaMessage, clientMsgID } = task;

      const messageKeyList = ["weekMessage", "monthMessage", "earlierMessage"] as const;

      const handleIndex = (key: (typeof messageKeyList)[number]) => {
        const index =
          latestLoadState.current?.[key].findIndex(
            (message) => message.clientMsgID === clientMsgID,
          ) ?? -1;
        if (index > -1) {
          setLoadState((state) => {
            const tmpMessage = [...state[key]];
            tmpMessage[index].localEx = filePath;
            return {
              ...state,
              [key]: tmpMessage,
            };
          });
        }
      };

      messageKeyList.forEach(handleIndex);

      if (!isMediaMessage) return;

      const tmpPreviewList = [...(latestLoadState.current?.previewItems ?? [])];
      const idx = tmpPreviewList.findIndex((item) => item.clientMsgID === clientMsgID);
      if (idx >= 0) {
        tmpPreviewList[idx].url = `file://${filePath}`;
        setLoadState((state) => ({
          ...state,
          previewItems: tmpPreviewList,
        }));
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
    setLoadState({
      loading: false,
      hasMore: true,
      pageIndex: 1,
      weekMessage: [],
      monthMessage: [],
      earlierMessage: [],
      previewItems: [],
    });
  }, [conversationID]);

  useEffect(() => {
    if (isActive) {
      void loadMore(true);
    } else {
      searchGeneration.current += 1;
    }
  }, [isActive]);

  const loadMore = async (clear = false) => {
    if (
      (!loadState.hasMore && !clear) ||
      (loadState.loading && !clear) ||
      !conversationID ||
      !isActiveRef.current
    )
      return;
    const generation = clear ? ++searchGeneration.current : searchGeneration.current;
    const requestPageIndex = clear ? 1 : loadState.pageIndex;
    setLoadState((state) => ({
      ...state,
      loading: true,
      pageIndex: requestPageIndex,
    }));

    try {
      const response = await scheduleIMSDKRequest(
        () =>
          IMSDK.searchLocalMessages({
            conversationID,
            keywordList: [],
            keywordListMatchType: 0,
            senderUserIDList: [],
            messageTypeList: [
              !isVideo ? MessageType.PictureMessage : MessageType.VideoMessage,
            ],
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
            useConversationStore.getState().currentConversation?.conversationID ===
              conversationID,
        },
      );
      if (
        !response ||
        generation !== searchGeneration.current ||
        !isActiveRef.current ||
        useConversationStore.getState().currentConversation?.conversationID !==
          conversationID
      )
        return;
      const searchData: ExMessageItem[] =
        response.data.searchResultItems?.[0]?.messageList ?? [];
      setLoadState((state) => {
        const weekMessage = clear ? [] : [...state.weekMessage];
        const monthMessage = clear ? [] : [...state.monthMessage];
        const earlierMessage = clear ? [] : [...state.earlierMessage];
        const previewItems = clear ? [] : [...state.previewItems];
        searchData.forEach((message) => {
          const time = message.sendTime;
          if (isThisWeek(time)) {
            weekMessage.push(message);
          } else if (isThisMonth(time)) {
            monthMessage.push(message);
          } else {
            earlierMessage.push(message);
          }
          if (!isVideo) {
            previewItems.push({
              url: getImageMessageSourceUrl(message) ?? "",
              clientMsgID: message.clientMsgID,
              thumbUrl: message.pictureElem?.snapshotPicture.url ?? "",
            });
          }
        });
        const seenClientMsgIDs = new Set<string>();
        const messages = [...weekMessage, ...monthMessage, ...earlierMessage].filter(
          (message) => {
            if (seenClientMsgIDs.has(message.clientMsgID)) return false;
            seenClientMsgIDs.add(message.clientMsgID);
            return true;
          },
        );
        const previewItemMap = new Map(
          previewItems.map((item) => [item.clientMsgID, item]),
        );
        return {
          loading: false,
          pageIndex: requestPageIndex + 1,
          hasMore: searchData.length === 20,
          weekMessage: messages.filter((message) => isThisWeek(message.sendTime)),
          monthMessage: messages.filter(
            (message) => !isThisWeek(message.sendTime) && isThisMonth(message.sendTime),
          ),
          earlierMessage: messages.filter(
            (message) =>
              !isThisWeek(message.sendTime) && !isThisMonth(message.sendTime),
          ),
          previewItems: messages
            .map((message) => previewItemMap.get(message.clientMsgID))
            .filter((item): item is PreviewGroupItem => Boolean(item)),
        };
      });
    } catch (error) {
      if (generation !== searchGeneration.current) return;
      setLoadState((state) => ({ ...state, loading: false }));
      feedbackToast({ error, msg: t("toast.getMessageListFailed") });
    }
  };

  const showAlbum = useCallback(
    (clientMsgID: string) => {
      const current = loadState.previewItems.findIndex(
        (img) => img.clientMsgID === clientMsgID,
      );
      if (current < 0) return;

      if (
        window.electronAPI &&
        loadState.previewItems[current].url.startsWith("http")
      ) {
        downloadFile(loadState.previewItems[current].url, {
          clientMsgID,
          conversationID,
          isMediaMessage: true,
          saveType: "image",
          showError: true,
        });
      }

      galleryRef.current?.setAlbumCurrent(current);
      galleryRef.current?.setAlbumVisible(true);
    },
    [loadState.previewItems.length],
  );

  const dataSource = [
    loadState.weekMessage,
    loadState.monthMessage,
    loadState.earlierMessage,
  ];

  return (
    <div className="h-full px-5.5 pb-2">
      {dataSource.flat().length > 0 ? (
        <Virtuoso
          className="h-full overflow-x-hidden"
          data={dataSource}
          endReached={() => loadMore()}
          components={{
            Footer: () => (loadState.loading ? <div>loading...</div> : null),
          }}
          itemContent={(index, messageList) => {
            switch (index) {
              case 0:
                return messageList.length ? (
                  <MediaMessageRow
                    title={t("date.thisWeek")}
                    messageList={messageList}
                    preview={showAlbum}
                  />
                ) : (
                  <PlaceholderEl />
                );
              case 1:
                return messageList.length ? (
                  <MediaMessageRow
                    title={t("date.thisMonth")}
                    messageList={messageList}
                    preview={showAlbum}
                  />
                ) : (
                  <PlaceholderEl />
                );
              case 2:
                return messageList.length ? (
                  <MediaMessageRow
                    title={t("date.earlier")}
                    messageList={messageList}
                    preview={showAlbum}
                  />
                ) : (
                  <PlaceholderEl />
                );
              default:
                return <PlaceholderEl />;
            }
          }}
        />
      ) : (
        <Empty
          className="flex h-full flex-col items-center justify-center"
          description={t("empty.noSearchResults")}
        />
      )}
      <ForwardGallery
        conversationID={conversationID}
        previewItems={loadState.previewItems}
        ref={galleryRef}
      />
    </div>
  );
};

export default MediaMessagePane;

const MediaMessageRow = ({
  title,
  messageList,
  preview,
}: {
  title: string;
  messageList: ExMessageItem[];
  preview: (clientMsgID: string) => void;
}) => (
  <div className="mb-3">
    <div className="mb-3">{title}</div>
    <div className="grid grid-cols-4 gap-2">
      {messageList.map((message) => (
        <MediaItem key={message.clientMsgID} preview={preview} message={message} />
      ))}
    </div>
  </div>
);

const previewInPlayer = (path: string) => {
  emitter.emit("OPEN_VIDEO_PLAYER", `file://${path}`);
};

const MediaItem = ({
  message,
  preview,
}: {
  message: ExMessageItem;
  preview: (clientMsgID: string) => void;
}) => {
  const { progress, downloadState, tryDownload } = useMessageFileDownloadState(
    message,
    previewInPlayer,
  );

  const isVideo = message.contentType === MessageType.VideoMessage;

  const tryPlayVideo = () => {
    if (window.electronAPI) {
      tryDownload();
      return;
    }
    emitter.emit("OPEN_VIDEO_PLAYER", message.videoElem.videoUrl);
  };

  const getSourceUrl = () => {
    if (
      !isVideo &&
      message.localEx &&
      window.electronAPI?.fileExists(message.localEx)
    ) {
      return message.localEx;
    }
    if (
      !isVideo &&
      message.pictureElem.sourcePath &&
      window.electronAPI?.fileExists(message.pictureElem.sourcePath)
    ) {
      return message.pictureElem.sourcePath;
    }
    if (
      isVideo &&
      message.videoElem.snapshotPath &&
      window.electronAPI?.fileExists(message.videoElem.snapshotPath)
    ) {
      return message.videoElem.snapshotPath;
    }
    return isVideo
      ? message.videoElem.snapshotUrl
      : message.pictureElem.snapshotPicture.url;
  };

  return (
    <div
      className={clsx(
        "grid-image relative flex h-[90px] items-center justify-center overflow-hidden rounded-md",
        { "cursor-pointer": isVideo },
      )}
      key={message.clientMsgID}
    >
      <CacheImage
        src={getSourceUrl()}
        height={90}
        preview={isVideo ? false : { visible: false }}
        onClick={() => !isVideo && preview?.(message.clientMsgID)}
        className="object-cover"
      />
      {isVideo && (
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-pointer"
          onClick={tryPlayVideo}
        >
          <FileDownloadIcon
            size={40}
            pausing={downloadState === "pause"}
            finished={downloadState === "finish" || !window.electronAPI}
            percent={progress}
          />
        </div>
      )}
    </div>
  );
};

const PlaceholderEl = () => <div className="h-px" />;

const PreviewGallery: ForwardRefRenderFunction<
  unknown,
  {
    previewItems: PreviewGroupItem[];
    conversationID?: string;
  }
> = ({ previewItems, conversationID }, ref) => {
  const [albumCurrent, setAlbumCurrent] = useState(0);
  const [albumVisible, setAlbumVisible] = useState(false);
  const imageCache = useUserStore((state) => state.imageCache);
  const updateDownloadTask = useMessageStore((state) => state.updateDownloadTask);

  const downloadOrShowFinder = (current: number) => {
    const { url, clientMsgID } = previewItems[current];
    const currentTask = getDownloadTask({
      downloadMap: useMessageStore.getState().downloadMap,
      compareKey: "clientMsgID",
      compareValue: clientMsgID,
    });
    if (currentTask?.downloadState === "pause") {
      window.electronAPI?.ipcInvoke("resumeDownload", currentTask?.downloadUrl);
      updateDownloadTask(currentTask?.downloadUrl ?? "", {
        downloadState: "downloading",
      });
      return;
    }
    if (!url.startsWith("http")) {
      window.electronAPI?.showInFinder(url.replace("file://", ""));
      return;
    }
    downloadFile(url, {
      clientMsgID,
      conversationID,
      isMediaMessage: true,
      saveType: "image",
      showError: true,
    });
  };

  useImperativeHandle(
    ref,
    () => ({
      setAlbumCurrent,
      setAlbumVisible,
    }),
    [],
  );

  const previewList = previewItems.map((image) => {
    if (!window.electronAPI || image.url.startsWith("file://") || !image.thumbUrl) {
      return image.url;
    }
    return imageCache[image.thumbUrl ?? ""]
      ? `file://${imageCache[image.thumbUrl ?? ""]}`
      : image.thumbUrl;
  });

  return (
    <div style={{ display: "none" }}>
      <Image.PreviewGroup
        items={previewList}
        preview={{
          current: albumCurrent,
          visible: albumVisible,
          toolbarRender: (originalNode, { current }) => (
            <PreviewToolsBar
              clientMsgID={previewItems[current].clientMsgID}
              dom={originalNode as JSX.Element}
              isFileDownloaded={!previewItems[current].url.startsWith("http")}
              onDownloadOrShowFinder={() => downloadOrShowFinder(current)}
            />
          ),
          onChange: (next) => setAlbumCurrent(next),
          onVisibleChange: (vis) => setAlbumVisible(vis),
        }}
      ></Image.PreviewGroup>
    </div>
  );
};

const ForwardGallery = memo(forwardRef(PreviewGallery));
