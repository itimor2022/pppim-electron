import { ExMessageItem, useMessageStore } from "@/store";

const MESSAGE_UPDATE_BATCH_MS = 100;

const pendingMessageUpdates = new Map<string, ExMessageItem>();
const afterFlushCallbacks = new Set<() => void>();
let messageUpdateTimer: ReturnType<typeof setTimeout> | undefined;

const flushMessageUpdates = () => {
  messageUpdateTimer = undefined;
  const messages = Array.from(pendingMessageUpdates.values());
  const callbacks = Array.from(afterFlushCallbacks);
  pendingMessageUpdates.clear();
  afterFlushCallbacks.clear();

  useMessageStore.getState().updateMessages(messages);
  callbacks.forEach((callback) => callback());
};

export const queueMessageUpdate = (
  message: ExMessageItem,
  afterFlush?: () => void,
) => {
  const pendingMessage = pendingMessageUpdates.get(message.clientMsgID);
  pendingMessageUpdates.set(
    message.clientMsgID,
    pendingMessage ? { ...pendingMessage, ...message } : message,
  );
  if (afterFlush) afterFlushCallbacks.add(afterFlush);

  if (!messageUpdateTimer) {
    messageUpdateTimer = setTimeout(flushMessageUpdates, MESSAGE_UPDATE_BATCH_MS);
  }
};
