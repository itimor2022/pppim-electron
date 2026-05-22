import { useDeepCompareEffect } from "ahooks";
import { ApplicationHandleResult } from "open-im-sdk-wasm";
import { GroupApplicationItem } from "open-im-sdk-wasm/lib/types/entity";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";

import ApplicationItem, { AccessFunction } from "@/components/ApplicationItem";
import { IMSDK } from "@/layout/MainContentWrap";
import { useUserStore } from "@/store";
import { useContactStore } from "@/store/contact";
import { feedbackToast } from "@/utils/common";
import { calcApplicationBadge } from "@/utils/imCommon";
import { setAccessedGroupApplication } from "@/utils/storage";

export const GroupNotifications = () => {
  const { t } = useTranslation();
  const currentUserID = useUserStore((state) => state.selfInfo.userID);

  const recvGroupApplicationList = useContactStore(
    (state) => state.recvGroupApplicationList,
  );
  const sendGroupApplicationList = useContactStore(
    (state) => state.sendGroupApplicationList,
  );
  const updateRecvGroupApplication = useContactStore(
    (state) => state.updateRecvGroupApplication,
  );
  const getRecvGroupApplicationListByReq = useContactStore(
    (state) => state.getRecvGroupApplicationListByReq,
  );

  const groupApplicationList = sortArray(
    recvGroupApplicationList.concat(sendGroupApplicationList),
  );

  useDeepCompareEffect(() => {
    const accessedGroupApplications = recvGroupApplicationList
      .filter(
        (application) =>
          application.handleResult === ApplicationHandleResult.Unprocessed,
      )
      .map((application) => `${application.userID}_${application.reqTime}`);
    setAccessedGroupApplication(accessedGroupApplications).then(calcApplicationBadge);
  }, [recvGroupApplicationList]);

  const onAccept = useCallback(
    async (application: GroupApplicationItem) => {
      if (application.handleResult !== ApplicationHandleResult.Unprocessed) {
        feedbackToast({
          msg: t("toast.groupApplicationHandled"),
          error: t("toast.groupApplicationHandled"),
        });
        return;
      }
      try {
        await IMSDK.acceptGroupApplication({
          groupID: application.groupID,
          fromUserID: application.userID,
          handleMsg: "",
        });
        await updateRecvGroupApplication({
          ...application,
          handleResult: ApplicationHandleResult.Agree,
        });
      } catch (error) {
        if (isGroupApplicationHandled(error)) {
          feedbackToast({
            msg: t("toast.groupApplicationHandled"),
            error,
          });
          await getRecvGroupApplicationListByReq();
          return;
        }
        feedbackToast({ error });
      }
    },
    [getRecvGroupApplicationListByReq, t, updateRecvGroupApplication],
  );

  const onReject = useCallback(
    async (application: GroupApplicationItem) => {
      if (application.handleResult !== ApplicationHandleResult.Unprocessed) {
        feedbackToast({
          msg: t("toast.groupApplicationHandled"),
          error: t("toast.groupApplicationHandled"),
        });
        return;
      }
      try {
        await IMSDK.refuseGroupApplication({
          groupID: application.groupID,
          fromUserID: application.userID,
          handleMsg: "",
        });
        await updateRecvGroupApplication({
          ...application,
          handleResult: ApplicationHandleResult.Reject,
        });
      } catch (error) {
        if (isGroupApplicationHandled(error)) {
          feedbackToast({
            msg: t("toast.groupApplicationHandled"),
            error,
          });
          await getRecvGroupApplicationListByReq();
          return;
        }
        feedbackToast({ error });
      }
    },
    [getRecvGroupApplicationListByReq, t, updateRecvGroupApplication],
  );

  return (
    <div className="flex h-full w-full flex-col bg-white">
      <p className="m-5.5 text-base font-extrabold">
        {t("placeholder.groupNotification")}
      </p>
      <div className="flex-1 pb-3">
        <Virtuoso
          className="h-full overflow-x-hidden"
          data={groupApplicationList}
          itemContent={(_, item) => (
            <ApplicationItem
              key={`${item.groupID}_${item.userID}_${item.reqTime}`}
              source={item}
              currentUserID={currentUserID}
              onAccept={onAccept as AccessFunction}
              onReject={onReject as AccessFunction}
            />
          )}
        />
      </div>
    </div>
  );
};

const sortArray = (list: GroupApplicationItem[]) => {
  list.sort((a, b) => {
    if (a.handleResult === 0 && b.handleResult === 0) {
      return b.reqTime - a.reqTime;
    } else if (a.handleResult === 0) {
      return -1;
    } else if (b.handleResult === 0) {
      return 1;
    }
    return 0;
  });
  return list;
};

const isGroupApplicationHandled = (error: unknown) => {
  const typedError = error as {
    code?: number | string;
    errCode?: number | string;
    errDlt?: string;
    errMsg?: string;
  };
  const errorCode = Number(typedError?.errCode ?? typedError?.code);
  return (
    errorCode === 1206 ||
    typedError?.errMsg === "GroupRequestHandled" ||
    typedError?.errDlt?.includes("GroupRequestHandled") === true
  );
};
