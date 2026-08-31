import { t } from "i18next";
import { v4 as uuidv4 } from "uuid";

import PinYin from "./pinyin";
import { message } from "../AntdGlobalComp";
import { FriendUserItem } from "open-im-sdk-wasm/lib/types/entity";
import { useMessageStore } from "@/store";
import { DownloadData } from "@/store/type";

const contactInitialMap = new Map<string, string>();
Object.entries(PinYin).forEach(([pinyin, characters]) => {
  const initial = pinyin.charAt(0).toUpperCase();
  for (const character of characters) {
    if (!contactInitialMap.has(character)) {
      contactInitialMap.set(character, initial);
    }
  }
});

const getContactInitial = (name?: string) => {
  for (const character of name ?? "unkown") {
    if (/[a-zA-Z]/.test(character)) {
      return character.toUpperCase();
    }
    if (/[0-9 -]/.test(character)) {
      return "#";
    }
    const initial = contactInitialMap.get(character);
    if (initial) {
      return initial;
    }
  }
  return "#";
};

type FeedbackToastParams = {
  msg?: string | null;
  error?: unknown;
  duration?: number;
  onClose?: () => void;
};

interface FeedbackError extends Error {
  errMsg?: string;
  errDlt?: string;
}
export const feedbackToast = (config?: FeedbackToastParams) => {
  const { msg, error, duration, onClose } = config ?? {};
  let content = "";
  if (error) {
    content =
      (error as FeedbackError)?.message ??
      (error as FeedbackError)?.errDlt ??
      t("toast.accessFailed");
  }
  message.open({
    type: error ? "error" : "success",
    content: msg ?? content ?? t("toast.accessSuccess"),
    duration,
    onClose,
  });
  if (error) {
    console.error(msg, error);
  }
};

export const bytesToSize = (bytes: number) => {
  if (bytes === 0) return "0 B";
  const k = 1024,
    sizes = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"],
    i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toPrecision(3)} ${sizes[i]}`;
};

export const secondsToTime = (seconds: number) => {
  let minutes = 0; // min
  let hours = 0; // hour
  let days = 0; // day
  if (seconds > 60) {
    minutes = parseInt((seconds / 60) as unknown as string);
    seconds = parseInt((seconds % 60) as unknown as string);
    if (minutes > 60) {
      hours = parseInt((minutes / 60) as unknown as string);
      minutes = parseInt((minutes % 60) as unknown as string);
      if (hours > 24) {
        days = parseInt((hours / 24) as unknown as string);
        hours = parseInt((hours % 24) as unknown as string);
      }
    }
  }
  let result = "";
  if (seconds > 0) {
    result = t("date.second", { num: parseInt(seconds as unknown as string) });
  }
  if (minutes > 0) {
    result = t("date.minute", { num: parseInt(minutes as unknown as string) }) + result;
  }
  if (hours > 0) {
    result = t("date.hour", { num: parseInt(hours as unknown as string) }) + result;
  }
  if (days > 0) {
    result = t("date.day", { num: parseInt(days as unknown as string) }) + result;
  }
  return result;
};

export const secondsToMS = (duration: number) => {
  let minutes = Math.floor(duration / 60) % 60;
  let seconds = (duration % 60).toString();
  minutes = minutes.toString().padStart(2, "0") as unknown as number;
  seconds = seconds.length === 1 ? "0" + seconds : seconds;
  return `${minutes}:${seconds}`;
};

export const formatContacts = (
  data: FriendUserItem[],
  key: keyof FriendUserItem = "nickname",
) => {
  const groups = new Map<string, FriendUserItem[]>();
  data.forEach((friend) => {
    const value = friend[key];
    const initial = getContactInitial(typeof value === "string" ? value : undefined);
    const friends = groups.get(initial) ?? [];
    friends.push(friend);
    groups.set(initial, friends);
  });

  const indexList = Array.from(groups.keys())
    .filter((initial) => initial !== "#")
    .sort();
  if (groups.has("#")) {
    indexList.push("#");
  }
  const dataList = indexList.map((initial) => groups.get(initial)!);
  return {
    indexList,
    dataList,
  };
};

export const filterEmptyValue = (obj: Record<string, unknown>) => {
  for (const key in obj) {
    if (obj[key] === "") {
      delete obj[key];
    }
  }
};

export const checkIsSafari = () =>
  /^((?!chrome|android).)*safari/i.test(navigator.userAgent) &&
  /iPad|iPhone|iPod/.test(navigator.userAgent);

const AUTO_DOWNLOAD_MAX_CONCURRENCY = 4;
const queuedAutoDownloadURLs = new Set<string>();
const activeAutoDownloadURLs = new Set<string>();
const pendingAutoDownloadOriginURLs = new Set<string>();
const autoDownloadOriginByURL = new Map<string, string>();
const autoDownloadQueue: Array<{
  downloadUrl: string;
  data: DownloadData;
}> = [];

const startElectronDownload = (downloadUrl: string, data: DownloadData) => {
  useMessageStore.getState().addDownloadTask(downloadUrl, {
    ...data,
    downloadUrl,
    downloadState: "downloading",
  });
  void Promise.resolve(
    window.electronAPI?.ipcInvoke("startDownload", {
      url: downloadUrl,
      saveType: data.saveType,
      randomPrefix: data.randomName ? uuidv4() : undefined,
    }),
  ).catch(() => {
    useMessageStore.getState().removeDownloadTask(downloadUrl);
    finishAutoDownload(downloadUrl);
    if (data.showError) message.error(t("toast.downloadFailed"));
  });
};

const runAutoDownloadQueue = () => {
  while (
    activeAutoDownloadURLs.size < AUTO_DOWNLOAD_MAX_CONCURRENCY &&
    autoDownloadQueue.length
  ) {
    const task = autoDownloadQueue.shift();
    if (!task) return;
    queuedAutoDownloadURLs.delete(task.downloadUrl);
    activeAutoDownloadURLs.add(task.downloadUrl);
    startElectronDownload(task.downloadUrl, task.data);
  }
};

export const finishAutoDownload = (downloadUrl: string) => {
  if (!activeAutoDownloadURLs.delete(downloadUrl)) return;
  const originUrl = autoDownloadOriginByURL.get(downloadUrl);
  if (originUrl) pendingAutoDownloadOriginURLs.delete(originUrl);
  autoDownloadOriginByURL.delete(downloadUrl);
  runAutoDownloadQueue();
};

export const downloadFile = async (originUrl: string, data: DownloadData) => {
  if (window.electronAPI) {
    try {
      const downloadUrl = originUrl;
      const hasTask =
        !!useMessageStore.getState().downloadMap[downloadUrl] ||
        queuedAutoDownloadURLs.has(downloadUrl) ||
        activeAutoDownloadURLs.has(downloadUrl) ||
        (data.isThumb && pendingAutoDownloadOriginURLs.has(originUrl));
      if (hasTask) return;

      const downloadData = {
        ...data,
        originUrl,
      };
      if (data.isThumb) {
        queuedAutoDownloadURLs.add(downloadUrl);
        pendingAutoDownloadOriginURLs.add(originUrl);
        autoDownloadOriginByURL.set(downloadUrl, originUrl);
        autoDownloadQueue.push({ downloadUrl, data: downloadData });
        runAutoDownloadQueue();
      } else {
        startElectronDownload(downloadUrl, downloadData);
      }
    } catch (error) {
      if (data.showError) message.error(t("toast.downloadFailed"));
    }
    return;
  }
  const linkNode = document.createElement("a");
  linkNode.style.display = "none";
  const idx = originUrl.lastIndexOf("/");
  linkNode.download = originUrl.slice(idx + 1);
  linkNode.href = originUrl;
  document.body.appendChild(linkNode);
  linkNode.click();
  document.body.removeChild(linkNode);
};

export const getDownloadTask = ({
  downloadMap,
  compareKey,
  compareValue,
}: {
  downloadMap: Record<string, DownloadData>;
  compareKey: keyof DownloadData;
  compareValue: unknown;
}) => {
  for (const key in downloadMap) {
    if (downloadMap[key][compareKey] === compareValue) {
      return downloadMap[key];
    }
  }
  return null;
};

export const getFileData = (data: Blob): Promise<ArrayBuffer> => {
  return new Promise((resolve, reject) => {
    let reader = new FileReader();
    reader.onload = function () {
      resolve(reader.result as ArrayBuffer);
    };
    reader.readAsArrayBuffer(data);
  });
};

export const base64toFile = (base64Str: string) => {
  var arr = base64Str.split(","),
    fileType = arr[0].match(/:(.*?);/)![1],
    bstr = atob(arr[1]),
    n = bstr.length,
    u8arr = new Uint8Array(n);

  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }

  return new File([u8arr], `screenshot${Date.now()}.png`, {
    type: fileType,
  });
};

export const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = function (evt) {
      const base64 = evt.target?.result;
      resolve(base64 as string);
    };
    reader.readAsDataURL(file);
  });

export const formatBr = (str: string) => str.replace(/\n/g, "<br>");

const longestCommonSubsequence = (str1: string, str2: string) => {
  const dp = Array.from({ length: str1.length + 1 }, () =>
    Array(str2.length + 1).fill(0),
  );

  for (let i = 1; i <= str1.length; i++) {
    for (let j = 1; j <= str2.length; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  let lcs = "";
  let i = str1.length;
  let j = str2.length;
  while (i > 0 && j > 0) {
    if (str1[i - 1] === str2[j - 1]) {
      lcs = str1[i - 1] + lcs;
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return lcs;
};

export const getExtraStr = (str1: string, str2: string) => {
  const lcs = longestCommonSubsequence(str1, str2);
  let extraPart = "";
  let lcsIndex = 0;

  for (let i = 0; i < str2.length; i++) {
    if (lcsIndex < lcs.length && str2[i] === lcs[lcsIndex]) {
      lcsIndex++;
    } else {
      extraPart += str2[i];
    }
  }

  return extraPart.slice(1);
};

export const getFileType = (name: string) => {
  const idx = name.lastIndexOf(".");
  return name.slice(idx + 1);
};

export const generateAvatar = (str: string, size = 40) => {
  str = !str ? t("placeholder.unknown") : str.split("")[0];
  let colors = ["#0072E3"];
  let cvs = document.createElement("canvas");
  cvs.setAttribute("width", size as unknown as string);
  cvs.setAttribute("height", size as unknown as string);
  let ctx = cvs.getContext("2d");
  ctx!.fillStyle = colors[Math.floor(Math.random() * colors.length)];
  ctx!.fillRect(0, 0, size, size);
  ctx!.fillStyle = "rgb(255,255,255)";
  ctx!.font = size * 0.4 + "px Arial";
  ctx!.textBaseline = "middle";
  ctx!.textAlign = "center";
  ctx!.fillText(str, size / 2, size / 2);
  return cvs.toDataURL("image/png", 1);
};
