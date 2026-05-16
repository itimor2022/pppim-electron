import { Image, Modal } from "antd";
import { FC, useEffect, useMemo, useRef, useState } from "react";

import { AppConfig } from "@/store/type";

const isEnabled = (value: AppConfig["announcementEnabled"]) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true";
  }
  return false;
};

const getAnnouncementKey = (config: AppConfig) =>
  [config.announcementType, config.announcementContent].filter(Boolean).join(":");

const AnnouncementModal: FC<{ config: AppConfig }> = ({ config }) => {
  const [open, setOpen] = useState(false);
  const shownKeyRef = useRef("");

  const announcementKey = useMemo(() => getAnnouncementKey(config), [config]);
  const type = config.announcementType ?? "text";
  const content = config.announcementContent?.trim() ?? "";

  useEffect(() => {
    if (!isEnabled(config.announcementEnabled) || !content || !announcementKey) return;
    if (shownKeyRef.current === announcementKey) return;
    shownKeyRef.current = announcementKey;
    setOpen(true);
  }, [announcementKey, config.announcementEnabled, content]);

  return (
    <Modal
      centered
      footer={null}
      open={open}
      title="公告"
      width={type === "image" ? 520 : 460}
      onCancel={() => setOpen(false)}
    >
      {type === "image" ? (
        <Image
          className="max-h-[70vh] w-full object-contain"
          preview={false}
          src={content}
        />
      ) : (
        <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words text-base leading-7 text-gray-800">
          {content}
        </div>
      )}
    </Modal>
  );
};

export default AnnouncementModal;
