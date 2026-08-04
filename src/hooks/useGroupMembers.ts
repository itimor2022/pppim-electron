import { useLatest } from "ahooks";
import { CbEvents } from "open-im-sdk-wasm";
import { GroupMemberFilter } from "open-im-sdk-wasm";
import { GroupMemberItem, WSEvent } from "open-im-sdk-wasm/lib/types/entity";
import { useCallback, useEffect, useRef, useState } from "react";

import { IMSDK } from "@/layout/MainContentWrap";
import { useConversationStore } from "@/store";
import { useUserStore } from "@/store";
import { feedbackToast } from "@/utils/common";

import { useCurrentMemberRole } from "./useCurrentMemberRole";

export const REACH_SEARCH_FLAG = "LAST_FLAG";

// 单次最多拉取的成员数量（避免大群成员过多时一直循环请求）。
// 这里做"第一页最多 100 条"，如果群成员总数 <= 100 则一次性拉完。
export const MEMBER_PAGE_SIZE = 100;
// 后续分页每页大小（用户主动"加载更多"时使用）
export const MEMBER_PAGE_STEP = 100;
// 搜索结果单页大小
export const SEARCH_PAGE_SIZE = 50;

export interface FetchStateType {
  offset: number;
  searchOffset: number;
  count: number;
  loading: boolean;
  hasMore: boolean;
  groupMemberList: GroupMemberItem[];
  searchMemberList: GroupMemberItem[];
  // 总成员数（-1 表示未知）
  groupMemberCount: number;
  // 是否已加载到第一页（100 条）上限，后续需要"加载更多"才能继续加载
  reachInitialLimit: boolean;
}

interface UseGroupMembersProps {
  groupID?: string;
  notRefresh?: boolean;
}

export default function useGroupMembers(props?: UseGroupMembersProps) {
  const { groupID, notRefresh } = props ?? {};
  const showGroupAllMembers = useUserStore(
    (state) => Number(state.appConfig.showGroupAllMembers ?? 1) === 1,
  );
  const { isAdmin, isOwner } = useCurrentMemberRole();
  const [fetchState, setFetchState] = useState<FetchStateType>({
    offset: 0,
    searchOffset: 0,
    count: MEMBER_PAGE_SIZE,
    loading: false,
    hasMore: true,
    groupMemberList: [],
    searchMemberList: [],
    groupMemberCount: -1,
    reachInitialLimit: false,
  });
  const latestFetchState = useLatest(fetchState);
  const lastKeyword = useRef("");
  const shouldLimitVisibleMembers = !showGroupAllMembers && !isAdmin && !isOwner;

  const filterMembers = useCallback(
    (list: GroupMemberItem[]) =>
      shouldLimitVisibleMembers
        ? list.filter((member) => member.roleLevel === 100 || member.roleLevel === 60)
        : list,
    [shouldLimitVisibleMembers],
  );

  useEffect(() => {
    const currentConversationGroupID =
      useConversationStore.getState().currentConversation?.groupID;
    if (!groupID && !currentConversationGroupID) return;
    const groupMemberInfoChangedHandler = ({
      data: member,
    }: WSEvent<GroupMemberItem>) => {
      if (member.groupID === latestFetchState.current.groupMemberList[0]?.groupID) {
        const idx = latestFetchState.current.groupMemberList.findIndex(
          (item) => item.userID === member.userID,
        );
        const newMembers = [...latestFetchState.current.groupMemberList];
        newMembers[idx] = { ...member };
        setFetchState((state) => ({
          ...state,
          groupMemberList: newMembers,
        }));
      }
    };

    const groupMemberCountHandler = ({ data }: WSEvent<GroupMemberItem>) => {
      if (notRefresh) {
        return;
      }
      if (
        data.groupID ===
        (groupID || latestFetchState.current.groupMemberList[0]?.groupID)
      ) {
        getMemberData(true);
      }
    };

    const setIMListener = () => {
      IMSDK.on(CbEvents.OnGroupMemberInfoChanged, groupMemberInfoChangedHandler);
      IMSDK.on(CbEvents.OnGroupMemberAdded, groupMemberCountHandler);
      IMSDK.on(CbEvents.OnGroupMemberDeleted, groupMemberCountHandler);
      IMSDK.on(CbEvents.OnJoinedGroupAdded, groupMemberCountHandler);
    };

    const disposeIMListener = () => {
      IMSDK.off(CbEvents.OnGroupMemberInfoChanged, groupMemberInfoChangedHandler);
      IMSDK.off(CbEvents.OnGroupMemberAdded, groupMemberCountHandler);
      IMSDK.off(CbEvents.OnGroupMemberDeleted, groupMemberCountHandler);
      IMSDK.off(CbEvents.OnJoinedGroupAdded, groupMemberCountHandler);
    };
    setIMListener();
    return () => {
      disposeIMListener();
    };
  }, [groupID]);

  const searchMember = useCallback(
    async (keyword: string) => {
      const isReach = keyword === REACH_SEARCH_FLAG;
      if (
        latestFetchState.current.loading ||
        (!latestFetchState.current.hasMore && isReach)
      )
        return;
      setFetchState((state) => ({
        ...state,
        loading: true,
      }));
      const currentConversationGroupID =
        useConversationStore.getState().currentConversation?.groupID;
      try {
        const { data } = await IMSDK.searchGroupMembers({
          groupID: groupID ?? currentConversationGroupID ?? "",
          offset: isReach ? latestFetchState.current.searchOffset : 0,
          count: SEARCH_PAGE_SIZE,
          keywordList: [keyword === REACH_SEARCH_FLAG ? lastKeyword.current : keyword],
          isSearchMemberNickname: true,
          isSearchUserID: true,
        });

        lastKeyword.current = keyword;
        const filteredData = filterMembers(data);
        setFetchState((state) => ({
          ...state,
          searchMemberList: [
            ...(isReach ? state.searchMemberList : []),
            ...filteredData,
          ],
          // 服务端返回数量小于请求数量，说明已经到末尾
          hasMore: data.length === SEARCH_PAGE_SIZE,
          searchOffset: state.searchOffset + SEARCH_PAGE_SIZE,
        }));
      } catch (error) {
        feedbackToast({
          msg: "getMemberFailed",
          error,
        });
      }

      setFetchState((state) => ({
        ...state,
        loading: false,
      }));
    },
    [groupID],
  );

  // 默认拉取逻辑：第一页一次性最多拉 MEMBER_PAGE_SIZE(100) 条成员。
  // 改用 `loadMoreMembers` 进行后续分页，避免大群持续触发 /api/group/get_group_member_list。
  const getMemberData = useCallback(
    async (refresh = false) => {
      const sourceID =
        groupID ?? useConversationStore.getState().currentConversation?.groupID ?? "";
      if (!sourceID) return;

      if (
        (latestFetchState.current.loading || !latestFetchState.current.hasMore) &&
        !refresh
      )
        return;

      setFetchState((state) => ({
        ...state,
        loading: true,
      }));
      try {
        // refresh=true 时重置到第一页；后续分页请使用 loadMoreMembers
        const { data } = await IMSDK.getGroupMemberList({
          groupID: sourceID,
          offset: refresh ? 0 : latestFetchState.current.offset,
          count: refresh ? MEMBER_PAGE_SIZE : MEMBER_PAGE_STEP,
          filter: GroupMemberFilter.All,
        });
        const filteredData = filterMembers(data);
        setFetchState((state) => {
          const nextList = [
            ...(refresh ? [] : state.groupMemberList),
            ...filteredData,
          ];
          // 服务端返回数量小于请求数量，说明已经到末尾
          const reachEnd = data.length < (refresh ? MEMBER_PAGE_SIZE : MEMBER_PAGE_STEP);
          // 第一页拉到上限就认为"达到初始限制"，需要用户手动加载更多
          const reachInitial =
            refresh && data.length >= MEMBER_PAGE_SIZE && !reachEnd;
          return {
            ...state,
            groupMemberList: nextList,
            hasMore: !reachEnd,
            offset: state.offset + (refresh ? MEMBER_PAGE_SIZE : MEMBER_PAGE_STEP),
            loading: false,
            reachInitialLimit:
              refresh ? reachInitial : state.reachInitialLimit || reachInitial,
          };
        });
      } catch (error) {
        feedbackToast({
          msg: "getMemberFailed",
          error,
        });
        setFetchState((state) => ({
          ...state,
          loading: false,
        }));
      }
    },
    [filterMembers, groupID, shouldLimitVisibleMembers],
  );

  // 主动加载更多（按 MEMBER_PAGE_STEP 步进）
  const loadMoreMembers = useCallback(async () => {
    return getMemberData(false);
  }, [getMemberData]);

  const resetState = () => {
    setFetchState({
      offset: 0,
      searchOffset: 0,
      count: MEMBER_PAGE_SIZE,
      loading: false,
      hasMore: true,
      groupMemberList: [],
      searchMemberList: [],
      groupMemberCount: -1,
      reachInitialLimit: false,
    });
  };

  return {
    fetchState,
    getMemberData,
    loadMoreMembers,
    searchMember,
    resetState,
  };
}