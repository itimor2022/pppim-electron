import clsx from "clsx";
import { t } from "i18next";
import { GroupItem } from "open-im-sdk-wasm/lib/types/entity";
import { memo, useEffect } from "react";

import invite from "@/assets/images/chatSetting/invite.png";
import kick from "@/assets/images/chatSetting/kick.png";
import OIMAvatar from "@/components/OIMAvatar";
import useGroupMembers from "@/hooks/useGroupMembers";
import { useUserStore } from "@/store";
import emitter from "@/utils/events";
import { getDisplayMemberCount } from "@/utils/group";

import styles from "./group-setting.module.scss";

const GroupMemberRow = ({
  currentGroupInfo,
  isNomal,
  updateTravel,
}: {
  currentGroupInfo: GroupItem;
  isNomal: boolean;
  updateTravel: () => void;
}) => {
  const { fetchState, getMemberData, resetState } = useGroupMembers();
  const showGroupAllMembers = useUserStore(
    (state) => Number(state.appConfig.showGroupAllMembers ?? 1) === 1,
  );

  useEffect(() => {
    if (currentGroupInfo?.groupID) {
      getMemberData(true);
    }
    return () => {
      resetState();
    };
  }, [currentGroupInfo?.groupID]);

  const sliceCount = isNomal ? 17 : 16;
  const displayMemberCount = getDisplayMemberCount(
    currentGroupInfo?.memberCount,
    currentGroupInfo?.ex,
  );
  const filteredMembers =
    !showGroupAllMembers && isNomal
      ? fetchState.groupMemberList.filter(
          (member) => member.roleLevel === 100 || member.roleLevel === 60,
        )
      : fetchState.groupMemberList;

  const inviteMember = (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    e.stopPropagation();
    emitter.emit("OPEN_CHOOSE_MODAL", {
      type: "INVITE_TO_GROUP",
      extraData: currentGroupInfo.groupID,
    });
  };

  const kickMember = (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    e.stopPropagation();
    emitter.emit("OPEN_CHOOSE_MODAL", {
      type: "KICK_FORM_GROUP",
      extraData: currentGroupInfo.groupID,
    });
  };

  return (
    <div className="p-4">
      <div className="mb-3 font-medium">
        <span>{t("placeholder.groupMember")}</span>
        <span className="ml-2">
          {!showGroupAllMembers && isNomal
            ? filteredMembers.length
            : displayMemberCount}
        </span>
      </div>
      <div className="flex flex-wrap items-center">
        {filteredMembers.slice(0, sliceCount).map((member) => (
          <div
            key={member.userID}
            title={member.nickname}
            className={styles["member-item"]}
            onClick={() => window.userClick(member.userID, member.groupID)}
          >
            <OIMAvatar src={member.faceURL} text={member.nickname} size={36} />
            <div className="mt-2 min-h-[16px] max-w-full truncate text-xs">
              {member.nickname}
            </div>
          </div>
        ))}
        <div
          className={clsx(styles["member-item"], "cursor-pointer")}
          onClick={inviteMember}
        >
          <img width={36} src={invite} alt="invite" />
          <div className="mt-2 max-w-full truncate text-xs text-[var(--sub-text)]">
            {t("placeholder.add")}
          </div>
        </div>
        {!isNomal && (
          <div
            className={clsx(styles["member-item"], "cursor-pointer")}
            onClick={kickMember}
          >
            <img width={36} src={kick} alt="kick" />
            <div className="mt-2 max-w-full truncate text-xs text-[var(--sub-text)]">
              {t("placeholder.remove")}
            </div>
          </div>
        )}
      </div>
      {(showGroupAllMembers || !isNomal) && (
        <div
          className="flex cursor-pointer items-center justify-center pt-2 text-xs text-[var(--primary)]"
          onClick={updateTravel}
        >
          {t("placeholder.viewMore")}
        </div>
      )}
    </div>
  );
};

export default memo(GroupMemberRow);
