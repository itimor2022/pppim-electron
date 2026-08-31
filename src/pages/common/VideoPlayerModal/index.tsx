import { CloseOutlined } from "@ant-design/icons";
import { Modal } from "antd";
import { FC, memo } from "react";

import VideoPlayer from "@/components/VideoPlayer";

const VideoPlayerModal: FC<{ url: string; closeOverlay: () => void }> = ({
  url,
  closeOverlay,
}) => {
  return (
    <Modal
      title={null}
      footer={null}
      closeIcon={<CloseOutlined className="text-lg font-medium text-gray-400" />}
      open
      centered
      destroyOnHidden
      onCancel={closeOverlay}
      styles={{
        mask: {
          opacity: 0,
          transition: "none",
        },
      }}
      className="no-padding-modal"
      maskTransitionName=""
    >
      <VideoPlayer url={url} autoplay />
    </Modal>
  );
};

export default memo(VideoPlayerModal);
