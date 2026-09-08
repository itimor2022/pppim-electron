const GROUP_MEMBER_REQUEST_MAX_CONCURRENCY = 4;
const GROUP_MEMBER_REQUEST_TIMEOUT_MS = 20_000;

export const installGroupMemberRequestScheduler = () => {
  const schedulerGlobal = globalThis as typeof globalThis & {
    __openimGroupMemberRequestSchedulerInstalled?: boolean;
  };
  if (schedulerGlobal.__openimGroupMemberRequestSchedulerInstalled) return;
  schedulerGlobal.__openimGroupMemberRequestSchedulerInstalled = true;

  const rawFetch = globalThis.fetch.bind(globalThis);
  const pendingRequests: Array<{
    input: RequestInfo | URL;
    init?: RequestInit;
    signal?: AbortSignal;
    abortHandler?: () => void;
    resolve: (response: Response) => void;
    reject: (reason?: unknown) => void;
  }> = [];
  let activeRequests = 0;

  const runPendingRequests = () => {
    while (
      activeRequests < GROUP_MEMBER_REQUEST_MAX_CONCURRENCY &&
      pendingRequests.length
    ) {
      const request = pendingRequests.shift();
      if (!request) return;
      if (request.signal?.aborted) {
        if (request.abortHandler) {
          request.signal.removeEventListener("abort", request.abortHandler);
        }
        request.reject(new DOMException("The operation was aborted.", "AbortError"));
        continue;
      }
      if (request.abortHandler) {
        request.signal?.removeEventListener("abort", request.abortHandler);
      }
      activeRequests += 1;
      const controller = new AbortController();
      let didTimeout = false;
      const abortActiveRequest = () => controller.abort(request.signal?.reason);
      request.signal?.addEventListener("abort", abortActiveRequest, { once: true });
      const timeout = setTimeout(() => {
        didTimeout = true;
        controller.abort();
      }, GROUP_MEMBER_REQUEST_TIMEOUT_MS);
      Promise.resolve()
        .then(() =>
          rawFetch(request.input, {
            ...request.init,
            signal: controller.signal,
          }),
        )
        .then(request.resolve)
        .catch((error) => {
          if (didTimeout) {
            request.reject(
              new DOMException("Group member request timed out.", "TimeoutError"),
            );
            return;
          }
          request.reject(error);
        })
        .finally(() => {
          clearTimeout(timeout);
          request.signal?.removeEventListener("abort", abortActiveRequest);
          activeRequests -= 1;
          runPendingRequests();
        });
    }
  };

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const requestURL =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!/\/group\/get_group_member_list(?:$|[?#])/.test(requestURL)) {
      return rawFetch(input, init);
    }
    return new Promise<Response>((resolve, reject) => {
      const signal =
        init?.signal ?? (input instanceof Request ? input.signal : undefined);
      if (signal?.aborted) {
        reject(new DOMException("The operation was aborted.", "AbortError"));
        return;
      }
      const request = { input, init, signal, resolve, reject } as {
        input: RequestInfo | URL;
        init?: RequestInit;
        signal?: AbortSignal;
        abortHandler?: () => void;
        resolve: (response: Response) => void;
        reject: (reason?: unknown) => void;
      };
      request.abortHandler = () => {
        const requestIndex = pendingRequests.indexOf(request);
        if (requestIndex < 0) return;
        pendingRequests.splice(requestIndex, 1);
        reject(new DOMException("The operation was aborted.", "AbortError"));
      };
      signal?.addEventListener("abort", request.abortHandler, { once: true });
      pendingRequests.push(request);
      runPendingRequests();
    });
  }) as typeof globalThis.fetch;
};
