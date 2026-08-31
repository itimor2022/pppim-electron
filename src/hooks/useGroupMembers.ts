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

export interface FetchStateType {
  offset: number;
  searchOffset: number;
  count: number;
  loading: boolean;
  searchLoading: boolean;
  hasMore: boolean;
  searchHasMore: boolean;
  groupMemberList: GroupMemberItem[];
  searchMemberList: GroupMemberItem[];
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
    count: 20,
    loading: false,
    searchLoading: false,
    hasMore: true,
    searchHasMore: true,
    groupMemberList: [],
    searchMemberList: [],
  });
  const latestFetchState = useLatest(fetchState);
  const lastKeyword = useRef("");
  const memberRequestInFlight = useRef(false);
  const memberRefreshRequested = useRef(false);
  const memberRequestGeneration = useRef(0);
  const searchRequestGeneration = useRef(0);
  const memberRefreshTimer = useRef<ReturnType<typeof setTimeout>>();
  const getMemberDataRef = useRef<(refresh?: boolean) => Promise<void>>(() =>
    Promise.resolve(),
  );
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
      const currentFetchState = latestFetchState.current;
      if (!currentFetchState) return;
      if (member.groupID === currentFetchState.groupMemberList[0]?.groupID) {
        const idx = currentFetchState.groupMemberList.findIndex(
          (item) => item.userID === member.userID,
        );
        if (idx < 0) return;
        const newMembers = [...currentFetchState.groupMemberList];
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
      const currentFetchState = latestFetchState.current;
      if (
        data.groupID === (groupID || currentFetchState?.groupMemberList[0]?.groupID)
      ) {
        if (memberRefreshTimer.current) {
          clearTimeout(memberRefreshTimer.current);
        }
        memberRefreshTimer.current = setTimeout(() => {
          memberRefreshTimer.current = undefined;
          void getMemberDataRef.current(true);
        }, 250);
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
      if (memberRefreshTimer.current) {
        clearTimeout(memberRefreshTimer.current);
        memberRefreshTimer.current = undefined;
      }
      disposeIMListener();
    };
  }, [groupID, latestFetchState, notRefresh]);

  const searchMember = useCallback(
    async (keyword: string) => {
      const isReach = keyword === REACH_SEARCH_FLAG;
      const currentFetchState = latestFetchState.current;
      if (!currentFetchState) return;
      if (
        (currentFetchState.searchLoading && isReach) ||
        (!currentFetchState.searchHasMore && isReach)
      )
        return;
      const searchKeyword = isReach ? lastKeyword.current : keyword;
      if (!searchKeyword) return;
      if (!isReach) {
        lastKeyword.current = keyword;
      }
      const requestGeneration = isReach
        ? searchRequestGeneration.current
        : ++searchRequestGeneration.current;
      const requestOffset = isReach ? currentFetchState.searchOffset : 0;
      setFetchState((state) => ({
        ...state,
        searchLoading: true,
        searchMemberList: isReach ? state.searchMemberList : [],
        searchOffset: isReach ? state.searchOffset : 0,
        searchHasMore: isReach ? state.searchHasMore : true,
      }));
      const currentConversationGroupID =
        useConversationStore.getState().currentConversation?.groupID;
      try {
        const { data } = await IMSDK.searchGroupMembers({
          groupID: groupID ?? currentConversationGroupID ?? "",
          offset: requestOffset,
          count: 20,
          keywordList: [searchKeyword],
          isSearchMemberNickname: true,
          isSearchUserID: true,
        });

        if (requestGeneration !== searchRequestGeneration.current) return;
        const filteredData = filterMembers(data);
        setFetchState((state) => ({
          ...state,
          searchMemberList: [
            ...(isReach ? state.searchMemberList : []),
            ...filteredData,
          ],
          searchHasMore: data.length === state.count,
          searchOffset: requestOffset + state.count,
          searchLoading: false,
        }));
      } catch (error) {
        if (requestGeneration !== searchRequestGeneration.current) return;
        feedbackToast({
          msg: "getMemberFailed",
          error,
        });
        setFetchState((state) => ({
          ...state,
          searchLoading: false,
        }));
      }
    },
    [filterMembers, groupID, latestFetchState],
  );

  const getMemberData = useCallback(
    async (refresh = false) => {
      const sourceID =
        groupID ?? useConversationStore.getState().currentConversation?.groupID ?? "";
      if (!sourceID) return;

      if (memberRequestInFlight.current) {
        if (refresh) memberRefreshRequested.current = true;
        return;
      }
      const currentFetchState = latestFetchState.current;
      if (!currentFetchState || (!refresh && !currentFetchState.hasMore)) return;

      memberRequestInFlight.current = true;
      const requestGeneration = ++memberRequestGeneration.current;
      const requestOffset = refresh ? 0 : currentFetchState.offset;
      setFetchState((state) => ({
        ...state,
        loading: true,
      }));
      try {
        const { data } = await IMSDK.getGroupMemberList({
          groupID: sourceID,
          offset: requestOffset,
          count: 20,
          filter: GroupMemberFilter.All,
        });
        if (
          requestGeneration !== memberRequestGeneration.current ||
          sourceID !==
            (groupID ??
              useConversationStore.getState().currentConversation?.groupID ??
              "")
        ) {
          return;
        }
        const filteredData = filterMembers(data);
        setFetchState((state) => ({
          ...state,
          groupMemberList: [...(refresh ? [] : state.groupMemberList), ...filteredData],
          hasMore: data.length === state.count,
          offset: requestOffset + state.count,
          loading: false,
        }));
      } catch (error) {
        if (requestGeneration !== memberRequestGeneration.current) return;
        feedbackToast({
          msg: "getMemberFailed",
          error,
        });
        setFetchState((state) => ({
          ...state,
          loading: false,
        }));
      } finally {
        if (requestGeneration === memberRequestGeneration.current) {
          memberRequestInFlight.current = false;
          if (memberRefreshRequested.current) {
            memberRefreshRequested.current = false;
            void getMemberData(true);
          }
        }
      }
    },
    [filterMembers, groupID, latestFetchState],
  );
  getMemberDataRef.current = getMemberData;

  const resetState = useCallback(() => {
    memberRequestGeneration.current += 1;
    searchRequestGeneration.current += 1;
    memberRequestInFlight.current = false;
    memberRefreshRequested.current = false;
    lastKeyword.current = "";
    if (memberRefreshTimer.current) {
      clearTimeout(memberRefreshTimer.current);
      memberRefreshTimer.current = undefined;
    }
    setFetchState({
      offset: 0,
      searchOffset: 0,
      count: 20,
      loading: false,
      searchLoading: false,
      hasMore: true,
      searchHasMore: true,
      groupMemberList: [],
      searchMemberList: [],
    });
  }, []);

  return {
    fetchState,
    getMemberData,
    searchMember,
    resetState,
  };
}
