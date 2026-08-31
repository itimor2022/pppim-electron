export type IMSDKRequestPriority = "high" | "normal" | "low";
export type IMSDKRequestLane = "interactive" | "background" | "history";

type QueuedRequest<T> = {
  lane: IMSDKRequestLane;
  priority: IMSDKRequestPriority;
  timeoutMs: number;
  deadlineAt: number;
  queueTimeout?: ReturnType<typeof setTimeout>;
  run: () => Promise<T>;
  isValid?: () => boolean;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

const INTERACTIVE_REQUEST_TIMEOUT_MS = 12_000;
const BACKGROUND_REQUEST_TIMEOUT_MS = 15_000;
const MAX_DETACHED_INVALID_REQUESTS = 2;
const REQUEST_VALIDITY_CHECK_INTERVAL_MS = 100;
const REQUEST_INVALIDATED = Symbol("IMSDKRequestInvalidated");

const createPriorityQueue = (): Record<
  IMSDKRequestPriority,
  QueuedRequest<unknown>[]
> => ({
  high: [],
  normal: [],
  low: [],
});

const requestQueues: Record<
  IMSDKRequestLane,
  Record<IMSDKRequestPriority, QueuedRequest<unknown>[]>
> = {
  interactive: createPriorityQueue(),
  background: createPriorityQueue(),
  history: createPriorityQueue(),
};

const requestRunning: Record<IMSDKRequestLane, boolean> = {
  interactive: false,
  background: false,
  history: false,
};

let detachedInvalidRequestCount = 0;

export class IMSDKRequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`IM SDK request timed out after ${timeoutMs}ms`);
    this.name = "IMSDKRequestTimeoutError";
  }
}

const getDefaultLane = (priority: IMSDKRequestPriority): IMSDKRequestLane =>
  priority === "high" ? "interactive" : "background";

const takeNextRequest = (lane: IMSDKRequestLane) =>
  requestQueues[lane].high.shift() ??
  requestQueues[lane].normal.shift() ??
  requestQueues[lane].low.shift();

const removeQueuedRequest = (request: QueuedRequest<unknown>) => {
  const queue = requestQueues[request.lane][request.priority];
  const index = queue.indexOf(request);
  if (index < 0) return false;
  queue.splice(index, 1);
  return true;
};

const runNextRequest = async (lane: IMSDKRequestLane) => {
  if (requestRunning[lane]) return;

  const request = takeNextRequest(lane);
  if (!request) return;
  if (request.queueTimeout) {
    clearTimeout(request.queueTimeout);
    request.queueTimeout = undefined;
  }
  if (request.isValid && !request.isValid()) {
    request.resolve(undefined);
    void runNextRequest(lane);
    return;
  }
  const remainingTimeoutMs = request.deadlineAt - Date.now();
  if (remainingTimeoutMs <= 0) {
    request.reject(new IMSDKRequestTimeoutError(request.timeoutMs));
    void runNextRequest(lane);
    return;
  }

  requestRunning[lane] = true;
  let requestSettled = false;
  let requestTimedOut = false;
  let requestDetached = false;
  let detachedRequestReleased = false;
  let invalidationWatcher: ReturnType<typeof setInterval> | undefined;
  let resolveInvalidation: (() => void) | undefined;
  const canDetachInvalidRequest = Boolean(request.isValid);
  const invalidationPromise = canDetachInvalidRequest
    ? new Promise<typeof REQUEST_INVALIDATED>((resolve) => {
        resolveInvalidation = () => resolve(REQUEST_INVALIDATED);
      })
    : undefined;
  const runningRequest = Promise.resolve().then(request.run);
  const clearInvalidationWatcher = () => {
    if (!invalidationWatcher) return;
    clearInterval(invalidationWatcher);
    invalidationWatcher = undefined;
  };
  const releaseDetachedRequest = () => {
    if (!requestDetached || detachedRequestReleased) return;
    detachedRequestReleased = true;
    detachedInvalidRequestCount = Math.max(0, detachedInvalidRequestCount - 1);
  };
  const detachRunningRequest = () => {
    if (
      requestSettled ||
      requestDetached ||
      detachedInvalidRequestCount >= MAX_DETACHED_INVALID_REQUESTS
    ) {
      return false;
    }

    requestDetached = true;
    detachedInvalidRequestCount += 1;
    clearInvalidationWatcher();
    requestRunning[lane] = false;
    void runNextRequest(lane);
    return true;
  };
  const tryDetachInvalidRequest = () => {
    if (
      requestSettled ||
      requestDetached ||
      !request.isValid ||
      request.isValid() ||
      !detachRunningRequest()
    ) {
      return;
    }
    resolveInvalidation?.();
  };
  if (canDetachInvalidRequest) {
    invalidationWatcher = setInterval(
      tryDetachInvalidRequest,
      REQUEST_VALIDITY_CHECK_INTERVAL_MS,
    );
  }
  void runningRequest.then(
    () => {
      requestSettled = true;
      clearInvalidationWatcher();
      if (requestDetached) {
        releaseDetachedRequest();
      } else if (requestTimedOut) {
        requestRunning[lane] = false;
        void runNextRequest(lane);
      }
    },
    () => {
      requestSettled = true;
      clearInvalidationWatcher();
      if (requestDetached) {
        releaseDetachedRequest();
      } else if (requestTimedOut) {
        requestRunning[lane] = false;
        void runNextRequest(lane);
      }
    },
  );

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      runningRequest,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          if (!requestSettled) {
            requestTimedOut = true;
            if (lane === "history") {
              detachRunningRequest();
            }
          }
          reject(new IMSDKRequestTimeoutError(request.timeoutMs));
        }, remainingTimeoutMs);
      }),
      ...(invalidationPromise ? [invalidationPromise] : []),
    ]);
    if (result === REQUEST_INVALIDATED) {
      request.resolve(undefined);
      return;
    }
    request.resolve(result);
  } catch (error) {
    request.reject(error);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (!requestTimedOut && !requestDetached) {
      clearInvalidationWatcher();
      requestRunning[lane] = false;
      void runNextRequest(lane);
    }
  }
};

export const scheduleIMSDKRequest = <T>(
  run: () => Promise<T>,
  options?: {
    priority?: IMSDKRequestPriority;
    lane?: IMSDKRequestLane;
    timeoutMs?: number;
    isValid?: () => boolean;
  },
) =>
  new Promise<T>((resolve, reject) => {
    const priority = options?.priority ?? "normal";
    const lane = options?.lane ?? getDefaultLane(priority);
    const timeoutMs =
      options?.timeoutMs ??
      (lane === "interactive"
        ? INTERACTIVE_REQUEST_TIMEOUT_MS
        : BACKGROUND_REQUEST_TIMEOUT_MS);
    const request = {
      lane,
      priority,
      timeoutMs,
      deadlineAt: Date.now() + timeoutMs,
      run,
      isValid: options?.isValid,
      resolve,
      reject,
    } as QueuedRequest<unknown>;
    request.queueTimeout = setTimeout(() => {
      request.queueTimeout = undefined;
      if (!removeQueuedRequest(request)) return;
      request.reject(new IMSDKRequestTimeoutError(request.timeoutMs));
      void runNextRequest(request.lane);
    }, timeoutMs);
    requestQueues[lane][priority].push(request);
    void runNextRequest(lane);
  });
