import { useHistoryTravel } from "ahooks";
import { Empty, Spin } from "antd";
import { t } from "i18next";
import { CbEvents } from "open-im-sdk-wasm";
import { WSEvent } from "open-im-sdk-wasm/lib/types/entity";
import {
  forwardRef,
  ForwardRefRenderFunction,
  memo,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { InfiniteData, useQueryClient } from "react-query";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";

import { getMomentsByID, useUserMoments } from "@/api/moments";
import DraggableModalWrap from "@/components/DraggableModalWrap";
import OIMAvatar from "@/components/OIMAvatar";
import { OverlayVisibleHandle, useOverlayVisible } from "@/hooks/useOverlayVisible";
import { IMSDK } from "@/layout/MainContentWrap";
import { useUserStore } from "@/store";
import { WorkMoments } from "@/types/moment";

import MomentsHeader from "./MomentsHeader";
import MomentsItemRender from "./MomentsItemRender";

export interface RouteTravel {
  nickname?: string;
  faceURL?: string;
  userID?: string;
  moments?: WorkMoments;
  updateMoments?: boolean;
}

const MomentsModalNew: ForwardRefRenderFunction<OverlayVisibleHandle> = (_, ref) => {
  const { isOverlayOpen, closeOverlay } = useOverlayVisible(ref);
  const virtuoso = useRef<VirtuosoHandle>(null);
  const headerRef = useRef<{ showMessages: () => void }>(null);
  const workMomentsUnreadCount = useUserStore((state) => state.workMomentsUnreadCount);

  const {
    value: routeTravel,
    setValue: setRouteTravel,
    backLength,
    go,
  } = useHistoryTravel<RouteTravel>({});
  const { isFetching, fetchNextPage, hasNextPage, refetch, data } = useUserMoments(
    isOverlayOpen,
    routeTravel?.userID,
  );
  const backStep = useRef(-1);

  const workMoments = data?.pages?.flat().filter((item) => Boolean(item)) ?? [];

  const queryClient = useQueryClient();

  useEffect(() => {
    const customMessageHandler = ({
      data: { key, data },
    }: WSEvent<{ key: string; data: string }>) => {
      if (key.includes("wm_")) {
        const updatedMoments = JSON.parse(data).body as WorkMoments;
        queryClient.setQueryData<InfiniteData<WorkMoments[]> | undefined>(
          routeTravel?.userID ?? "SelfMoments",
          (oldData) => {
            if (!oldData) return oldData;
            const newPages = oldData.pages.map((page) =>
              page.map((item) =>
                item.workMomentID === updatedMoments.workMomentID
                  ? updatedMoments
                  : item,
              ),
            );
            return {
              ...oldData,
              pages: newPages,
            };
          },
        );
      }
    };
    IMSDK.on(CbEvents.OnRecvCustomBusinessMessage, customMessageHandler);
    return () => {
      IMSDK.off(CbEvents.OnRecvCustomBusinessMessage, customMessageHandler);
    };
  }, [routeTravel?.userID]);

  const endReached = () => {
    if (!isFetching && hasNextPage) {
      fetchNextPage();
    }
  };

  const updateRouteTravel = useCallback(
    (travel: RouteTravel) => {
      if (
        travel.userID &&
        (travel.userID === routeTravel?.userID ||
          travel.userID === routeTravel?.moments?.userID)
      )
        return;
      if (
        travel.moments?.workMomentID &&
        !travel.updateMoments &&
        travel.moments?.workMomentID === routeTravel?.moments?.workMomentID
      )
        return;

      if (travel.updateMoments && !routeTravel?.moments && travel.moments) return;

      if (travel.updateMoments) {
        backStep.current -= 1;
      } else {
        backStep.current = -1;
      }

      setRouteTravel({ ...travel });
    },
    [JSON.stringify(routeTravel)],
  );

  const backPreviousState = useCallback(() => go(backStep.current), []);

  const jumpToMoments = useCallback((workMomentID: string) => {
    getMomentsByID(workMomentID).then(({ data: { workMoment } }) => {
      setRouteTravel({ moments: workMoment });
    });
  }, []);

  return (
    <DraggableModalWrap
      open={isOverlayOpen}
      title={null}
      footer={null}
      width={550}
      onCancel={closeOverlay}
      closeIcon={null}
      centered
      className="no-padding-modal"
      mask={false}
      ignoreClasses=".ignore-drag, .cursor-pointer, .ant-modal-wrap"
    >
      <div className="relative h-[80vh]">
        <MomentsHeader
          ref={headerRef}
          canBack={Boolean(backLength)}
          activeUserID={routeTravel?.userID}
          refetch={refetch}
          closeOverlay={closeOverlay}
          jumpToMoments={jumpToMoments}
          backPreviousState={backPreviousState}
        />
        {routeTravel?.moments?.workMomentID ? (
          <div className="pt-10">
            <MomentsItemRender
              moments={routeTravel.moments}
              activeUserID={routeTravel?.userID}
              backPreviousState={backPreviousState}
              updateRouteTravel={updateRouteTravel}
            />
          </div>
        ) : (
          <Virtuoso
            data={workMoments}
            ref={virtuoso}
            className="no-scrollbar"
            endReached={endReached}
            computeItemKey={(_, moments) => moments.workMomentID}
            components={{
              Header: () => (
                <>
                  <div className="relative h-[280px] bg-[url(@/assets/images/moments/background.png)]">
                    {routeTravel?.userID && (
                      <div className="absolute bottom-4 left-3 flex items-center">
                        <OIMAvatar
                          size={48}
                          src={routeTravel?.faceURL}
                          text={routeTravel?.nickname}
                        />
                        <div className="ml-2 max-w-[200px] truncate font-medium text-white">
                          {routeTravel?.nickname}
                        </div>
                      </div>
                    )}
                  </div>
                  {Boolean(workMomentsUnreadCount) && (
                    <div className="my-3 flex items-center justify-center">
                      <div
                        className="cursor-pointer rounded-md bg-[#b6bbc2] px-3 py-1 text-sm text-white"
                        onClick={() => headerRef.current?.showMessages()}
                      >
                        {t("placeholder.multipleNewMessages", {
                          count: workMomentsUnreadCount,
                        })}
                      </div>
                    </div>
                  )}
                </>
              ),
              Footer: () =>
                isFetching ? (
                  <div className="mt-[20%] flex justify-center">
                    <Spin />
                  </div>
                ) : null,
              EmptyPlaceholder: () =>
                !isFetching ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={t("empty.noMoments")}
                  />
                ) : null,
            }}
            itemContent={(_, moments) => (
              <MomentsItemRender
                moments={moments}
                activeUserID={routeTravel?.userID}
                backPreviousState={backPreviousState}
                updateRouteTravel={updateRouteTravel}
              />
            )}
          />
        )}
      </div>
    </DraggableModalWrap>
  );
};

export default memo(forwardRef(MomentsModalNew));
