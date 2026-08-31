import { useLatest } from "ahooks";
import { Image, Spin } from "antd";
import {
  forwardRef,
  ForwardRefRenderFunction,
  memo,
  ReactNode,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import PreviewToolsBar from "@/components/PreviewToolsBar";
import VideoPlayer from "@/components/VideoPlayer";
import { useConversationStore, useMessageStore, useUserStore } from "@/store";
import { PreviewGroupItem } from "@/store/type";
import FileDownloadIcon from "@/svg/FileDownloadIcon";
import { downloadFile, getDownloadTask } from "@/utils/common";

const MediaPreview: ForwardRefRenderFunction<
  { showAlbum: (clientMsgID: string) => void },
  { conversationID: string }
> = ({ conversationID }, ref) => {
  const [albumVisible, setAlbumVisible] = useState(false);
  const latestVisible = useLatest(albumVisible);
  const [autoPlay, setAutoPlay] = useState(false);
  const [albumCurrent, setAlbumCurrent] = useState(0);
  const albumCurrentClientMsgID = useRef<string>();
  const previewImgList = useMessageStore((state) => state.previewImgList);
  const updateDownloadTask = useMessageStore((state) => state.updateDownloadTask);
  const imageCache = useUserStore((state) => state.imageCache);
  const getConversationPreviewImgList = useMessageStore(
    (state) => state.getConversationPreviewImgList,
  );

  useEffect(() => {
    if (!latestVisible.current || !albumCurrentClientMsgID.current) return;
    const nextIndex = previewImgList.findIndex(
      (image) => image.clientMsgID === albumCurrentClientMsgID.current,
    );
    if (nextIndex >= 0) setAlbumCurrent(nextIndex);
  }, [latestVisible, previewImgList]);

  const downloadOrShowFinder = (current: number) => {
    const { url, videoUrl, clientMsgID } = previewImgList[current];
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
    const sourceUrl = videoUrl ?? url;
    if (!sourceUrl.startsWith("http")) {
      window.electronAPI?.showInFinder(sourceUrl.replace("file://", ""));
      return;
    }
    downloadFile(sourceUrl, {
      clientMsgID,
      conversationID,
      isMediaMessage: true,
      showError: true,
      saveType: videoUrl ? "video" : "image",
    });
  };

  const showAlbum = async (clientMsgID: string) => {
    let current = previewImgList.findIndex((img) => img.clientMsgID === clientMsgID);
    let findItem = previewImgList[current];
    if (current < 0) {
      await getConversationPreviewImgList();
      current = useMessageStore
        .getState()
        .previewImgList.findIndex((img) => img.clientMsgID === clientMsgID);
      findItem = useMessageStore.getState().previewImgList[current];
    }
    if (current < 0) return;
    albumCurrentClientMsgID.current = clientMsgID;
    const sourceUrl = findItem.videoUrl ?? findItem.url;
    if (window.electronAPI && sourceUrl.startsWith("http")) {
      downloadFile(sourceUrl, {
        clientMsgID,
        conversationID,
        isMediaMessage: true,
        showError: true,
        saveType: findItem.videoUrl ? "video" : "image",
      });
    } else {
      setAutoPlay(true);
      setTimeout(() => setAutoPlay(false), 200);
    }
    setAlbumCurrent(current);
    setAlbumVisible(true);
  };

  const onToggle = (next: number) => {
    albumCurrentClientMsgID.current = previewImgList[next].clientMsgID;
    const sourceUrl = previewImgList[next].videoUrl ?? previewImgList[next].url;
    if (window.electronAPI && sourceUrl.startsWith("http")) {
      downloadFile(sourceUrl, {
        clientMsgID: previewImgList[next].clientMsgID,
        conversationID,
        isMediaMessage: true,
        showError: true,
        saveType: previewImgList[next].videoUrl ? "video" : "image",
      });
    }
    setAlbumCurrent(next);
  };

  useImperativeHandle(ref, () => ({ showAlbum }), [previewImgList]);

  const previewList = previewImgList.map((image) => {
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
        preview={{
          current: albumCurrent,
          visible: albumVisible,
          destroyOnClose: true,
          toolbarRender: (originalNode, { current }) => {
            const previewItem = previewImgList[current];
            const isFileDownloadedField = previewItem.videoUrl ? "videoUrl" : "url";
            const isFileDownloaded = Boolean(
              previewItem[isFileDownloadedField]?.startsWith("file://"),
            );
            return (
              <PreviewToolsBar
                clientMsgID={previewItem.clientMsgID}
                isFileDownloaded={isFileDownloaded}
                dom={originalNode as JSX.Element}
                hiddenImageAction={previewItem.videoUrl !== undefined}
                onDownloadOrShowFinder={() => downloadOrShowFinder(current)}
              />
            );
          },
          imageRender: (originNode, { current }) => (
            <PreviewItemRender
              dom={originNode}
              source={previewImgList[current]}
              autoplay={autoPlay}
              visible={albumVisible && current === albumCurrent}
            />
          ),
          onVisibleChange: (vis) => {
            if (!vis) setAutoPlay(false);
            setAlbumVisible(vis);
          },
          onChange: onToggle,
        }}
        items={previewList}
      />
    </div>
  );
};

const ForwardMediaPreview = memo(forwardRef(MediaPreview));

export default ForwardMediaPreview;

const PreviewItemRender = ({
  dom,
  source,
  autoplay,
  visible,
}: {
  dom: ReactNode;
  source: PreviewGroupItem;
  autoplay: boolean;
  visible: boolean;
}) => {
  const updateDownloadTask = useMessageStore((state) => state.updateDownloadTask);
  const currentTask = useMessageStore((state) =>
    getDownloadTask({
      downloadMap: state.downloadMap,
      compareKey: "clientMsgID",
      compareValue: source.clientMsgID,
    }),
  );

  const tryPlayVideo = () => {
    if (
      currentTask?.downloadState === "downloading" ||
      currentTask?.downloadState === "resume"
    ) {
      window.electronAPI?.ipcInvoke("pauseDownload", currentTask.downloadUrl!);
      updateDownloadTask(currentTask.downloadUrl!, {
        downloadState: "pause",
      });
      return;
    }

    if (currentTask?.downloadState === "pause") {
      window.electronAPI?.ipcInvoke("resumeDownload", currentTask.downloadUrl!);
      updateDownloadTask(currentTask.downloadUrl!, {
        downloadState: "downloading",
      });
      return;
    }

    if (!currentTask && source.videoUrl) {
      downloadFile(source.videoUrl, {
        isMediaMessage: true,
        showError: true,
        saveType: "video",
        clientMsgID: source.clientMsgID,
        conversationID:
          useConversationStore.getState().currentConversation?.conversationID,
      });
    }
  };

  if (!visible) return null;

  if (!source.videoUrl) {
    return (
      <>
        {dom}
        <div className="absolute -z-10 flex items-center justify-center">
          <Spin spinning />
        </div>
      </>
    );
  }

  const isVideoDownloaded = source.videoUrl?.startsWith("file://");

  if (source.videoUrl?.startsWith("file://") || !window.electronAPI) {
    return (
      <div className="relative">
        <VideoPlayer url={source.videoUrl} autoplay={autoplay} poster={source.url} />
      </div>
    );
  }

  return (
    <>
      {dom}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-pointer"
        onClick={tryPlayVideo}
      >
        <FileDownloadIcon
          size={40}
          pausing={currentTask?.downloadState === "pause"}
          finished={isVideoDownloaded || !window.electronAPI}
          percent={currentTask?.progress ?? 0}
        />
      </div>
      <div className="absolute -z-10 flex items-center justify-center">
        <Spin spinning />
      </div>
    </>
  );
};
