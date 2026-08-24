import type { ConversationItem, GroupMemberItem } from "open-im-sdk-wasm/lib/types/entity";
import { v4 as uuidv4 } from "uuid";

import { getApiUrl, SDK_VERSION } from "@/config";
import createAxiosInstance from "@/utils/request";
import { getIMToken } from "@/utils/storage";

const request = createAxiosInstance(getApiUrl());

interface FileItem {
  filename: string;
  url: string;
}

export const uploadLogs = async (fileURLs: FileItem[]) => {
  const token = (await getIMToken()) as string;
  return request<unknown>({
    url: "/third/logs/upload",
    method: "POST",
    data: {
      platform: window.electronAPI?.getPlatform() ?? 5,
      version: SDK_VERSION,
      systemType: window.electronAPI?.getSystemVersion() ?? "",
      ex: "",
      fileURLs,
    },
    headers: {
      token,
      operationID: uuidv4(),
    },
  });
};

export const getServerGroupMembersInfo = (params: {
  groupID: string;
  userIDs: string[];
}) =>
  request.post<{ members: GroupMemberItem[] }>("/group/get_group_members_info", params);

/**
 * 分页拉取服务端活跃会话列表(登录同步窗口化后, 本地库仅包含最近活跃会话,
 * 更老的会话通过该接口"下拉加载更多")。
 */
export const getActiveConversations = (params: {
  offset: number;
  count: number;
  userID?: string;
}) =>
  request.post<{
    total: number;
    conversations: ConversationItemWithRemoteFlag[];
  }>("/conversation/get_active_conversation_list", params);

export type ConversationItemWithRemoteFlag = ConversationItem & {
  /** 标识该会话尚未同步进 SDK 本地库, 点击时需先 getOneConversation 建立 */
  onlyRemote?: boolean;
};

