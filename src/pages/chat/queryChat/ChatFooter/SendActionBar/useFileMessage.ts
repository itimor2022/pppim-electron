import { v4 as uuidV4 } from "uuid";

import { IMSDK } from "@/layout/MainContentWrap";
import { ExMessageItem } from "@/store";
import { base64toFile } from "@/utils/common";

export interface FileWithPath extends File {
  path?: string;
}

export function useFileMessage() {
  const getImageMessage = async (file: FileWithPath) => {
    const { width, height } = await getPicInfo(file);
    const baseInfo = {
      uuid: uuidV4(),
      type: file.type,
      size: file.size,
      width,
      height,
      url: URL.createObjectURL(file),
    };
    const sourcePath =
      (await window.electronAPI?.saveFileToDisk({
        file,
        sync: true,
        type: "sentFileCache",
      })) || `/${file.name}`;
    const options = {
      sourcePicture: baseInfo,
      bigPicture: baseInfo,
      snapshotPicture: baseInfo,
      sourcePath,
      file,
    };

    return (await IMSDK.createImageMessageByFile(options)).data;
  };

  const getVideoMessage = async (file: FileWithPath, snapShotFile: FileWithPath) => {
    const { width, height } = await getPicInfo(snapShotFile);
    const snapshotPath =
      (await window.electronAPI?.saveFileToDisk({
        sync: true,
        file: snapShotFile,
        type: "sentFileCache",
      })) || `/${snapShotFile.name}`;
    const videoPath =
      (await window.electronAPI?.saveFileToDisk({
        file,
        sync: true,
        type: "sentFileCache",
      })) || `/${file.name}`;
    const videoObjectUrl = URL.createObjectURL(file);
    const duration = await getMediaDuration(videoObjectUrl);
    URL.revokeObjectURL(videoObjectUrl);
    const options = {
      videoFile: file,
      snapshotFile: snapShotFile,
      videoPath,
      duration,
      videoType: file.type,
      snapshotPath,
      videoUUID: uuidV4(),
      videoUrl: "",
      videoSize: file.size,
      snapshotUUID: uuidV4(),
      snapshotSize: snapShotFile.size,
      snapshotUrl: URL.createObjectURL(snapShotFile),
      snapshotWidth: width,
      snapshotHeight: height,
      snapShotType: snapShotFile.type,
    };
    return (await IMSDK.createVideoMessageByFile(options)).data;
  };

  const getFileMessage = async (file: FileWithPath) => {
    const filePath =
      (await window.electronAPI?.saveFileToDisk({
        file,
        sync: true,
        type: "sentFileCache",
      })) || `/${file.name}`;
    const options = {
      file: (await window.electronAPI?.getFileByPath(filePath)) || file,
      filePath,
      fileName: file.name,
      uuid: uuidV4(),
      sourceUrl: "",
      fileSize: file.size,
      fileType: file.type,
    };
    return (await IMSDK.createFileMessageByFile(options)).data;
  };

  const createFileMessage = async (file: FileWithPath): Promise<ExMessageItem> => {
    const isImage = file.type.includes("image");
    const isVideo =
      file.type.includes("video") || /\.(mp4|mov|m4v|webm)$/i.test(file.name);
    if (isImage) {
      return await getImageMessage(file);
    }
    if (isVideo) {
      const snapShotFile = await getVideoSnshotFile(file);
      return await getVideoMessage(file, snapShotFile);
    }
    return await getFileMessage(file);
  };

  const getFileType = (name: string) => {
    const idx = name.lastIndexOf(".");
    return name.slice(idx + 1);
  };

  const getPicInfo = (file: File): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const _URL = window.URL || window.webkitURL;
      const img = new Image();
      img.onload = function () {
        resolve(img);
      };
      img.src = _URL.createObjectURL(file);
    });

  const getVideoSnshotFile = (file: File): Promise<File> => {
    const url = URL.createObjectURL(file);
    return new Promise((resolve, reject) => {
      let settled = false;
      let lastSnapshotFile: File | null = null;
      const video = document.createElement("video");
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      const cleanup = () => {
        window.clearTimeout(timer);
        URL.revokeObjectURL(url);
        video.removeAttribute("src");
        video.load();
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("Failed to capture video snapshot"));
      };
      const isDarkFrame = () => {
        if (!ctx || !canvas.width || !canvas.height) return true;
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const step = Math.max(4, Math.floor(imageData.length / 4000 / 4) * 4);
        let sampled = 0;
        let visible = 0;

        for (let i = 0; i < imageData.length; i += step) {
          const alpha = imageData[i + 3];
          if (alpha < 10) continue;
          sampled += 1;
          const brightness = imageData[i] + imageData[i + 1] + imageData[i + 2];
          if (brightness > 72) {
            visible += 1;
          }
        }

        return sampled === 0 || visible / sampled < 0.01;
      };
      const capture = () => {
        if (!video.videoWidth || !video.videoHeight || !ctx) {
          fail();
          return null;
        }
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
        const snapshotFile = base64toFile(canvas.toDataURL("image/png"));
        lastSnapshotFile = snapshotFile;
        return {
          file: snapshotFile,
          isDark: isDarkFrame(),
        };
      };
      const finish = (snapshotFile: File) => {
        if (settled) return;
        settled = true;
        video.pause();
        cleanup();
        resolve(snapshotFile);
      };
      const seekTo = (time: number) =>
        new Promise<void>((resolveSeek, rejectSeek) => {
          const clear = () => {
            window.clearTimeout(seekTimer);
            video.removeEventListener("seeked", onSeeked);
            video.removeEventListener("error", onError);
          };
          const onSeeked = () => {
            clear();
            resolveSeek();
          };
          const onError = () => {
            clear();
            rejectSeek(new Error("Failed to seek video"));
          };
          const seekTimer = window.setTimeout(() => {
            clear();
            rejectSeek(new Error("Video seek timeout"));
          }, 2000);

          video.addEventListener("seeked", onSeeked);
          video.addEventListener("error", onError);
          try {
            video.currentTime = time;
          } catch (error) {
            clear();
            rejectSeek(error);
          }
        });
      const waitForFrameData = () =>
        new Promise<void>((resolveFrame, rejectFrame) => {
          if (video.readyState >= 2) {
            resolveFrame();
            return;
          }
          const clear = () => {
            window.clearTimeout(frameTimer);
            video.removeEventListener("loadeddata", onLoadedData);
            video.removeEventListener("error", onError);
          };
          const onLoadedData = () => {
            clear();
            resolveFrame();
          };
          const onError = () => {
            clear();
            rejectFrame(new Error("Failed to load video frame"));
          };
          const frameTimer = window.setTimeout(() => {
            clear();
            rejectFrame(new Error("Video frame load timeout"));
          }, 2000);

          video.addEventListener("loadeddata", onLoadedData);
          video.addEventListener("error", onError);
        });
      const getCandidateTimes = () => {
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        if (!duration) return [];
        const maxTime = Math.max(duration - 0.1, 0);
        return Array.from(
          new Set(
            [0.1, duration * 0.1, duration * 0.25, duration * 0.5, duration * 0.75]
              .map((time) => Math.min(Math.max(time, 0.1), maxTime))
              .filter((time) => time > 0 && time <= maxTime),
          ),
        );
      };
      const captureCandidateFrames = async () => {
        const candidateTimes = getCandidateTimes();
        if (!candidateTimes.length) {
          try {
            await waitForFrameData();
          } catch {
            fail();
            return;
          }
          const snapshot = capture();
          if (snapshot) {
            finish(snapshot.file);
          }
          return;
        }

        for (const time of candidateTimes) {
          if (settled) return;
          try {
            await seekTo(time);
          } catch {
            continue;
          }
          const snapshot = capture();
          if (!snapshot) return;
          if (!snapshot.isDark) {
            finish(snapshot.file);
            return;
          }
        }

        if (lastSnapshotFile) {
          finish(lastSnapshotFile);
          return;
        }
        try {
          await waitForFrameData();
        } catch {
          fail();
          return;
        }
        const snapshot = capture();
        if (snapshot) {
          finish(snapshot.file);
          return;
        }
        fail();
      };
      const timer = window.setTimeout(fail, 8000);

      video.muted = true;
      video.preload = "auto";
      video.playsInline = true;
      video.crossOrigin = "anonymous";
      video.addEventListener("loadedmetadata", () => {
        void captureCandidateFrames();
      });
      video.addEventListener("error", fail);
      video.src = url;
      video.load();
    });
  };

  const getMediaDuration = (path: string): Promise<number> =>
    new Promise((resolve) => {
      const vel = new Audio(path);
      vel.onloadedmetadata = function () {
        resolve(Number(vel.duration.toFixed()));
      };
      vel.onerror = function () {
        resolve(0);
      };
    });

  return {
    getImageMessage,
    getVideoMessage,
    getFileMessage,
    createFileMessage,
    getPicInfo,
    getVideoSnshotFile,
  };
}
