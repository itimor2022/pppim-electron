import { t } from "i18next";
import { MessageType, SessionType } from "open-im-sdk-wasm";
import { MessageItem } from "open-im-sdk-wasm/lib/types/entity";
import { create } from "zustand";

import { IMSDK } from "@/layout/MainContentWrap";
import { feedbackToast } from "@/utils/common";
import {
  IMSDKRequestTimeoutError,
  scheduleIMSDKRequest,
} from "@/utils/imSdkRequestScheduler";

import { useConversationStore } from "./conversation";
import {
  DownloadData,
  MessageStore,
  PreviewGroupItem,
  UpdateMessaggeBaseInfoParams,
} from "./type";
import { useUserStore } from "./user";

const GET_HISTORY_MESSAGE_COUNT = 20;
const MAX_HISTORY_PAGE_REQUESTS = 3;
const HISTORY_MESSAGE_GAP_MS = 300_000;
const HISTORY_SEARCH_MESSAGE_TYPES = Object.values(MessageType).filter(
  (value): value is MessageType => typeof value === "number",
);

const isTransientHistoryError = (error: unknown) => {
  if (error instanceof IMSDKRequestTimeoutError) return true;
  if (!error || typeof error !== "object") return false;

  const sdkError = error as {
    errCode?: number;
    errMsg?: string;
    name?: string;
    message?: string;
  };
  const errorText = `${sdkError.errMsg ?? ""} ${sdkError.message ?? ""}`;
  return (
    sdkError.name === "OpenIMSDKCallTimeoutError" ||
    sdkError.name === "OpenIMSDKServiceRestartError" ||
    (sdkError.errCode === 10005 &&
      /invoke javascript timeout|call to released function/i.test(errorText))
  );
};

type HistoryRequestType = "initial" | "older" | "newer" | "jump";
type HistoryDirection = "older" | "newer";

let historyConversationID = "";
let historyRequestGeneration = 0;
const pendingHistoryRequests = new Map<string, Promise<unknown>>();

const resetHistoryRequestContext = (conversationID = "") => {
  historyConversationID = conversationID;
  historyRequestGeneration += 1;
  pendingHistoryRequests.clear();
};

const ensureHistoryRequestContext = (conversationID: string) => {
  if (historyConversationID !== conversationID) {
    resetHistoryRequestContext(conversationID);
  }
  return historyRequestGeneration;
};

const isCurrentHistoryRequest = (
  conversationID: string,
  generation: number,
  checkCurrentConversation = true,
) =>
  historyConversationID === conversationID &&
  historyRequestGeneration === generation &&
  (!checkCurrentConversation ||
    useConversationStore.getState().currentConversation?.conversationID ===
      conversationID);

const runSingleHistoryRequest = <T>(
  conversationID: string,
  requestType: HistoryRequestType,
  request: (generation: number) => Promise<T>,
) => {
  const generation = ensureHistoryRequestContext(conversationID);
  const requestKey = `${conversationID}:${requestType}`;
  const pendingRequest = pendingHistoryRequests.get(requestKey);
  if (pendingRequest) return pendingRequest as Promise<T>;

  const nextRequest = request(generation).finally(() => {
    if (pendingHistoryRequests.get(requestKey) === nextRequest) {
      pendingHistoryRequests.delete(requestKey);
    }
  });
  pendingHistoryRequests.set(requestKey, nextRequest);
  return nextRequest;
};

const applyMessageGapState = (messageList: ExMessageItem[]) => {
  const gapStates = new Array<boolean>(messageList.length).fill(false);
  messageList.forEach((message, index) => {
    if (!index) return;
    const newerMessage = messageList[index - 1];
    const hasGap = newerMessage.sendTime - message.sendTime > HISTORY_MESSAGE_GAP_MS;
    const gapMessageIndex =
      newerMessage.sessionType === SessionType.Notification ? index : index - 1;
    gapStates[gapMessageIndex] = hasGap;
  });
  return messageList.map((message, index) =>
    Boolean(message.gapTime) === gapStates[index]
      ? message
      : { ...message, gapTime: gapStates[index] },
  );
};

const mergeMessageList = (...messageLists: ExMessageItem[][]) => {
  const messageMap = new Map<string, ExMessageItem>();
  messageLists.forEach((messageList) => {
    messageList.forEach((message) => {
      const key = message.clientMsgID || message.serverMsgID;
      const oldMessage = messageMap.get(key);
      messageMap.set(key, oldMessage ? { ...oldMessage, ...message } : message);
    });
  });
  return applyMessageGapState(
    Array.from(messageMap.values()).sort((left, right) => {
      if (left.seq > 0 && right.seq > 0 && left.seq !== right.seq) {
        return right.seq - left.seq;
      }
      return right.sendTime - left.sendTime;
    }),
  );
};

type VisibleHistoryResult = {
  messages: ExMessageItem[];
  lastMinSeq: number;
  startClientMsgID: string;
  hasMore: boolean;
};

type LocalSearchHistoryResult = {
  messages: ExMessageItem[];
};

const shouldHideHistoryMessage = (_message: ExMessageItem) => false;

const isHistoryCursorMoved = (
  previousClientMsgID: string,
  previousLastMinSeq: number,
  nextClientMsgID: string,
  nextLastMinSeq: number,
) => previousLastMinSeq !== nextLastMinSeq || previousClientMsgID !== nextClientMsgID;

const collectVisibleHistoryMessages = async ({
  conversationID,
  direction,
  startClientMsgID,
  lastMinSeq,
  generation,
  checkCurrentConversation = true,
}: {
  conversationID: string;
  direction: HistoryDirection;
  startClientMsgID: string;
  lastMinSeq: number;
  generation: number;
  checkCurrentConversation?: boolean;
}): Promise<VisibleHistoryResult | undefined> => {
  const messages: ExMessageItem[] = [];
  let cursorClientMsgID = startClientMsgID;
  let cursorLastMinSeq = lastMinSeq;
  let rawCount = 0;
  let isEnd = false;
  let canLoadMore = true;
  let pageRequestCount = 0;
  let cursorMoved = true;

  while (canLoadMore && pageRequestCount < MAX_HISTORY_PAGE_REQUESTS) {
    pageRequestCount += 1;
    const previousClientMsgID = cursorClientMsgID;
    const previousLastMinSeq = cursorLastMinSeq;
    const response = await scheduleIMSDKRequest(
      () =>
        direction === "older"
          ? IMSDK.getAdvancedHistoryMessageList({
              userID: "",
              groupID: "",
              count: GET_HISTORY_MESSAGE_COUNT,
              lastMinSeq: cursorLastMinSeq,
              startClientMsgID: cursorClientMsgID,
              conversationID,
            })
          : IMSDK.getAdvancedHistoryMessageListReverse({
              userID: "",
              groupID: "",
              count: GET_HISTORY_MESSAGE_COUNT,
              lastMinSeq: cursorLastMinSeq,
              startClientMsgID: cursorClientMsgID,
              conversationID,
            }),
      {
        priority: "high",
        lane: "history",
        isValid: () =>
          isCurrentHistoryRequest(conversationID, generation, checkCurrentConversation),
      },
    );

    if (
      !response ||
      !isCurrentHistoryRequest(conversationID, generation, checkCurrentConversation)
    ) {
      return;
    }
    const { data } = response;
    const rawList = (data.messageList ?? []) as ExMessageItem[];
    rawCount = rawList.length;
    if (!rawCount) {
      isEnd = data.isEnd;
      canLoadMore = false;
      continue;
    }

    isEnd = data.isEnd;
    const nextCursorMessage =
      direction === "older" ? rawList[0] : rawList[rawList.length - 1];
    const nextClientMsgID = nextCursorMessage?.clientMsgID ?? "";
    cursorMoved = isHistoryCursorMoved(
      previousClientMsgID,
      previousLastMinSeq,
      nextClientMsgID,
      data.lastMinSeq,
    );
    cursorClientMsgID = nextClientMsgID;
    cursorLastMinSeq = data.lastMinSeq;

    const visibleList = rawList.filter((message) => !shouldHideHistoryMessage(message));
    if (visibleList.length) {
      messages.push(...[...visibleList].reverse());
      if (messages.length >= GET_HISTORY_MESSAGE_COUNT) {
        canLoadMore = false;
        continue;
      }
    }

    if (isEnd) {
      canLoadMore = false;
      continue;
    }
    if (!cursorMoved) {
      isEnd = true;
      canLoadMore = false;
    }
  }

  return {
    messages,
    lastMinSeq: cursorLastMinSeq,
    startClientMsgID: cursorClientMsgID,
    hasMore: !isEnd && (rawCount === 0 || cursorMoved),
  };
};

const collectLocalSearchHistory = async ({
  conversationID,
  pageIndex,
  generation,
}: {
  conversationID: string;
  pageIndex: number;
  generation: number;
}): Promise<LocalSearchHistoryResult | undefined> => {
  const response = await scheduleIMSDKRequest(
    () =>
      IMSDK.searchLocalMessages({
        conversationID,
        keywordList: [],
        messageTypeList: HISTORY_SEARCH_MESSAGE_TYPES,
        pageIndex,
        count: GET_HISTORY_MESSAGE_COUNT,
      }),
    {
      priority: "high",
      lane: "history",
      isValid: () => isCurrentHistoryRequest(conversationID, generation),
    },
  );
  if (!response || !isCurrentHistoryRequest(conversationID, generation)) return;

  const resultItem = response.data.searchResultItems?.find(
    (item) => item.conversationID === conversationID,
  );
  const messages = ((resultItem?.messageList ?? []) as ExMessageItem[]).filter(
    (message) => !shouldHideHistoryMessage(message),
  );
  return {
    messages,
  };
};

export interface ExType {
  checked?: boolean;
  isAppend?: boolean;
  gapTime?: boolean;
  jump?: boolean;
  errCode?: number;
}

export type ExMessageItem = MessageItem & ExType;

const MediaMessageTypes = [MessageType.PictureMessage, MessageType.VideoMessage];

const getMessagePreviewItems = (messageList: ExMessageItem[]): PreviewGroupItem[] =>
  messageList
    .filter((message) => MediaMessageTypes.includes(message.contentType))
    .map((message) => ({
      url: getImageMessageSourceUrl(message) ?? "",
      clientMsgID: message.clientMsgID,
      videoUrl: getVideoMessageSourceUrl(message),
      thumbUrl: message.pictureElem?.snapshotPicture.url ?? "",
    }));

const mergePreviewImgList = (
  messageList: ExMessageItem[],
  currentList: PreviewGroupItem[],
) => {
  const previewMap = new Map<string, PreviewGroupItem>();
  [...getMessagePreviewItems(messageList), ...currentList].forEach((preview) => {
    if (!previewMap.has(preview.clientMsgID)) {
      previewMap.set(preview.clientMsgID, preview);
    }
  });
  return Array.from(previewMap.values());
};

export const useMessageStore = create<MessageStore>()((set, get) => ({
  historyMessageList: [],
  previewImgList: [],
  jumpLoading: false,
  jumpClientMsgID: undefined,
  lastMinSeq: 0,
  historyStartClientMsgID: "",
  laterLastMinSeq: 0,
  laterStartClientMsgID: "",
  hasMore: true,
  laterHasMore: false,
  isCheckMode: false,
  downloadMap: {},
  getHistoryMessageListByReq: async (loadMore = false) => {
    const conversationID =
      useConversationStore.getState().currentConversation?.conversationID;
    if (!conversationID) return;
    return runSingleHistoryRequest(
      conversationID,
      loadMore ? "older" : "initial",
      async (generation) => {
        const applyLocalSearchResult = (result: LocalSearchHistoryResult) => {
          if (!isCurrentHistoryRequest(conversationID, generation)) return;
          const currentState = get();
          const nextList = mergeMessageList(
            currentState.historyMessageList,
            result.messages,
          );
          set(() => ({
            historyMessageList: nextList,
            previewImgList: mergePreviewImgList(nextList, currentState.previewImgList),
          }));
        };

        try {
          const state = get();
          const shouldContinueFromCursor =
            loadMore || Boolean(state.historyStartClientMsgID || state.lastMinSeq);
          const result = await collectVisibleHistoryMessages({
            conversationID,
            direction: "older",
            startClientMsgID: shouldContinueFromCursor
              ? state.historyStartClientMsgID
              : "",
            lastMinSeq: shouldContinueFromCursor ? state.lastMinSeq : 0,
            generation,
          });
          if (!result || !isCurrentHistoryRequest(conversationID, generation)) {
            return;
          }
          const currentState = get();
          const nextList = mergeMessageList(
            currentState.historyMessageList,
            result.messages,
          );

          set(() => ({
            lastMinSeq: result.lastMinSeq,
            historyStartClientMsgID: result.startClientMsgID,
            laterLastMinSeq: loadMore ? currentState.laterLastMinSeq : 0,
            laterStartClientMsgID: loadMore ? currentState.laterStartClientMsgID : "",
            hasMore: result.hasMore,
            laterHasMore: loadMore ? currentState.laterHasMore : false,
            historyMessageList: nextList,
            previewImgList: mergePreviewImgList(nextList, currentState.previewImgList),
          }));
          return result.messages.length > 0 || !result.hasMore;
        } catch (error) {
          if (!isCurrentHistoryRequest(conversationID, generation)) return;
          const isTransientTimeout = isTransientHistoryError(error);
          if (isTransientTimeout) {
            try {
              const currentState = get();
              const searchResult = await collectLocalSearchHistory({
                conversationID,
                pageIndex: loadMore
                  ? Math.max(
                      2,
                      Math.floor(
                        currentState.historyMessageList.length /
                          GET_HISTORY_MESSAGE_COUNT,
                      ) + 1,
                    )
                  : 1,
                generation,
              });
              if (!searchResult) return;
              applyLocalSearchResult(searchResult);
              return false;
            } catch (fallbackError) {
              if (
                isCurrentHistoryRequest(conversationID, generation) &&
                !isTransientHistoryError(fallbackError)
              ) {
                feedbackToast({
                  error: fallbackError,
                  msg: t("toast.getHistoryMessageFailed"),
                });
              }
              return false;
            }
          }
          if (!isTransientTimeout) {
            feedbackToast({ error, msg: t("toast.getHistoryMessageFailed") });
          }
          return false;
        }
      },
    );
  },
  getHistoryMessageListReverseByReq: async () => {
    const conversationID =
      useConversationStore.getState().currentConversation?.conversationID;
    if (!conversationID) return;
    return runSingleHistoryRequest(conversationID, "newer", async (generation) => {
      try {
        const state = get();
        const result = await collectVisibleHistoryMessages({
          conversationID,
          direction: "newer",
          startClientMsgID:
            state.laterStartClientMsgID ||
            state.historyMessageList[0]?.clientMsgID ||
            "",
          lastMinSeq:
            state.laterLastMinSeq ||
            state.historyMessageList.find((message) => Boolean(message.seq))?.seq ||
            0,
          generation,
        });
        if (!result || !isCurrentHistoryRequest(conversationID, generation)) {
          return;
        }
        set((currentState) => ({
          laterLastMinSeq: result.lastMinSeq,
          laterStartClientMsgID: result.startClientMsgID,
          laterHasMore: result.hasMore,
          historyMessageList: mergeMessageList(
            result.messages,
            currentState.historyMessageList,
          ),
        }));
      } catch (error) {
        if (!isCurrentHistoryRequest(conversationID, generation)) return;
        if (!isTransientHistoryError(error)) {
          feedbackToast({ error, msg: t("toast.getHistoryMessageFailed") });
          set(() => ({ laterHasMore: false }));
        }
      }
    });
  },
  getTwoWayHistoryMessage: async ({ message, conversationID }) => {
    resetHistoryRequestContext(conversationID);
    set(() => ({ jumpLoading: true }));
    return runSingleHistoryRequest(conversationID, "jump", async (generation) => {
      const loadOptions = {
        conversationID,
        startClientMsgID: message.clientMsgID,
        lastMinSeq: message.seq,
        generation,
        checkCurrentConversation: false,
      };
      try {
        const [earlierResult, laterResult] = await Promise.all([
          collectVisibleHistoryMessages({
            ...loadOptions,
            direction: "older",
          }),
          collectVisibleHistoryMessages({
            ...loadOptions,
            direction: "newer",
          }),
        ]);
        if (
          !earlierResult ||
          !laterResult ||
          !isCurrentHistoryRequest(conversationID, generation, false)
        ) {
          return false;
        }
        set(() => ({
          lastMinSeq: earlierResult.lastMinSeq,
          historyStartClientMsgID: earlierResult.startClientMsgID,
          laterLastMinSeq: laterResult.lastMinSeq,
          laterStartClientMsgID: laterResult.startClientMsgID,
          jumpClientMsgID: message.clientMsgID,
          hasMore: earlierResult.hasMore,
          laterHasMore: laterResult.hasMore,
          historyMessageList: mergeMessageList(
            laterResult.messages,
            [message],
            earlierResult.messages,
          ),
        }));
        return true;
      } catch (error) {
        if (!isCurrentHistoryRequest(conversationID, generation, false)) return false;
        if (!isTransientHistoryError(error)) {
          feedbackToast({ error, msg: t("toast.getHistoryMessageFailed") });
        }
        return false;
      } finally {
        if (isCurrentHistoryRequest(conversationID, generation, false)) {
          set(() => ({ jumpLoading: false }));
        }
      }
    });
  },
  clearAppendState: () => {
    set((state) => ({
      historyMessageList: state.historyMessageList.map((message) => ({
        ...message,
        isAppend: false,
      })),
    }));
  },
  updateJumpClientMsgID: (jumpClientMsgID?: string) => set(() => ({ jumpClientMsgID })),
  pushNewMessage: (message: ExMessageItem) => {
    get().pushNewMessages([message]);
  },
  pushNewMessages: (messages: ExMessageItem[]) => {
    if (!messages.length) return;
    set((state) => {
      const historyMessageList = mergeMessageList(messages, state.historyMessageList);
      return {
        historyMessageList,
        previewImgList: mergePreviewImgList(messages, state.previewImgList),
      };
    });
  },
  updateOneMessage: (message: ExMessageItem, fromMediaDownload = false) => {
    get().updateMessages([message], fromMediaDownload);
  },
  updateMessages: (messages: ExMessageItem[], fromMediaDownload = false) => {
    if (!messages.length) return;
    const updateMap = new Map(
      messages.map((message) => [message.clientMsgID, message]),
    );

    set((state) => {
      let historyChanged = false;
      const historyMessageList = state.historyMessageList.map((message) => {
        const update = updateMap.get(message.clientMsgID);
        if (!update) return message;
        historyChanged = true;
        return { ...message, ...update };
      });

      let previewChanged = false;
      const previewImgList = fromMediaDownload
        ? state.previewImgList.map((preview) => {
            const update = updateMap.get(preview.clientMsgID);
            if (!update?.localEx) return preview;
            previewChanged = true;
            const field = preview.videoUrl ? "videoUrl" : "url";
            return {
              ...preview,
              [field]: `file://${update.localEx}`,
            };
          })
        : state.previewImgList;

      if (!historyChanged && !previewChanged) return state;
      return {
        historyMessageList: historyChanged
          ? historyMessageList
          : state.historyMessageList,
        previewImgList: previewChanged ? previewImgList : state.previewImgList,
      };
    });
  },
  deleteOneMessage: (clientMsgID: string) => {
    set((state) => ({
      historyMessageList: state.historyMessageList.filter(
        (message) => message.clientMsgID !== clientMsgID,
      ),
    }));
  },
  deleteAndPushOneMessage: (message: ExMessageItem) => {
    const tmpList = get().historyMessageList;
    const idx = tmpList.findIndex((msg) => msg.clientMsgID === message.clientMsgID);
    if (idx < 0) {
      return;
    }
    tmpList.splice(idx, 1);
    set(() => ({ historyMessageList: [message, ...tmpList] }));
  },
  updateMessageNicknameAndFaceUrl: ({
    sendID,
    senderFaceUrl,
    senderNickname,
  }: UpdateMessaggeBaseInfoParams) => {
    const tmpList = [...get().historyMessageList].map((message) => {
      if (message.sendID === sendID) {
        message.senderFaceUrl = senderFaceUrl;
        message.senderNickname = senderNickname;
      }
      return message;
    });
    set(() => ({ historyMessageList: tmpList }));
  },
  clearHistoryMessage: () => {
    resetHistoryRequestContext(
      useConversationStore.getState().currentConversation?.conversationID ?? "",
    );
    set(() => ({
      historyMessageList: [],
      previewImgList: [],
      jumpLoading: false,
      jumpClientMsgID: undefined,
      lastMinSeq: 0,
      historyStartClientMsgID: "",
      laterLastMinSeq: 0,
      laterStartClientMsgID: "",
      hasMore: true,
      laterHasMore: false,
      isCheckMode: false,
    }));
  },
  updateCheckMode: (isCheckMode: boolean) => {
    if (!isCheckMode) {
      const tmpList = [...get().historyMessageList].map((message) => {
        message.checked = false;
        return message;
      });
      set(() => ({ historyMessageList: tmpList }));
    }
    set(() => ({ isCheckMode }));
  },
  getConversationPreviewImgList: async () => {
    const conversationID =
      useConversationStore.getState().currentConversation?.conversationID;

    if (!conversationID) return;
    const response = await scheduleIMSDKRequest(
      () =>
        IMSDK.searchLocalMessages({
          conversationID,
          keywordList: [],
          keywordListMatchType: 0,
          senderUserIDList: [],
          messageTypeList: [MessageType.PictureMessage, MessageType.VideoMessage],
          searchTimePosition: 0,
          searchTimePeriod: 0,
          pageIndex: 1,
          count: 200,
        }),
      {
        priority: "low",
        isValid: () =>
          useConversationStore.getState().currentConversation?.conversationID ===
          conversationID,
      },
    );
    if (
      !response ||
      useConversationStore.getState().currentConversation?.conversationID !==
        conversationID
    ) {
      return;
    }
    const {
      data: { searchResultItems },
    } = response;
    if (!searchResultItems?.[0].messageCount) return;
    set((state) => ({
      previewImgList: mergePreviewImgList(
        searchResultItems[0].messageList as ExMessageItem[],
        state.previewImgList,
      ),
    }));
  },
  tryAddPreviewImg: (mesageList: ExMessageItem[]) => {
    if (
      !mesageList.some((message) => MediaMessageTypes.includes(message.contentType))
    ) {
      return;
    }
    set((state) => ({
      previewImgList: mergePreviewImgList(mesageList, state.previewImgList),
    }));
  },
  addDownloadTask: (url: string, data: DownloadData) => {
    set((state) => ({
      downloadMap: { ...state.downloadMap, [url]: { ...data } },
    }));
  },
  updateDownloadTask: (url: string, data: DownloadData) => {
    const tmpMap = { ...get().downloadMap };
    tmpMap[url] = {
      ...tmpMap[url],
      ...data,
    };
    set(() => ({ downloadMap: tmpMap }));
  },
  removeDownloadTask: (url: string) => {
    const tmpMap = { ...get().downloadMap };
    if (!tmpMap[url]) return;
    delete tmpMap[url];
    set(() => ({ downloadMap: tmpMap }));
  },
}));

export const getImageMessageSourceUrl = (message: ExMessageItem) => {
  if (message.contentType === MessageType.VideoMessage) {
    const snapshotPath = message.videoElem.snapshotPath;
    if (snapshotPath && window.electronAPI?.fileExists(snapshotPath)) {
      return `file://${snapshotPath}`;
    }
    const snapshotUrl = message.videoElem.snapshotUrl;
    const cachePath = useUserStore.getState().imageCache[snapshotUrl];
    if (cachePath && window.electronAPI?.fileExists(cachePath)) {
      return `file://${cachePath}`;
    }
    return snapshotUrl;
  }

  if (message.localEx && window.electronAPI?.fileExists(message.localEx)) {
    return `file://${message.localEx}`;
  }
  if (window.electronAPI?.fileExists(message.pictureElem.sourcePath)) {
    return `file://${message.pictureElem.sourcePath}`;
  }
  return message.pictureElem.sourcePicture.url;
};

export const getVideoMessageSourceUrl = (message: ExMessageItem) => {
  if (message.contentType !== MessageType.VideoMessage) return undefined;
  if (message.localEx && window.electronAPI?.fileExists(message.localEx)) {
    return `file://${message.localEx}`;
  }
  if (window.electronAPI?.fileExists(message.videoElem.videoPath)) {
    return `file://${message.videoElem.videoPath}`;
  }
  return message.videoElem.videoUrl;
};
