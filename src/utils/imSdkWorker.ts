import { installGroupMemberRequestScheduler } from "./groupMemberRequestScheduler";

type WorkerSDKConfig = {
  coreWasmPath: string;
  sqlWasmPath: string;
  wasmExecPath: string;
};

type WorkerRequest =
  | {
      type: "init";
      config: WorkerSDKConfig;
    }
  | {
      type: "call";
      requestID: number;
      method: string;
      args: unknown[];
    };

const workerScope = globalThis as unknown as {
  postMessage: (message: unknown) => void;
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<WorkerRequest>) => void,
  ) => void;
};

Reflect.set(globalThis, "window", globalThis);

let sdkPromise: Promise<Record<string, unknown>> | undefined;

const postWorkerMessage = (message: unknown) => workerScope.postMessage(message);

const serializeError = (error: unknown) => {
  if (!error || typeof error !== "object") return error;
  const serialized = Object.fromEntries(Object.entries(error));
  if (error instanceof Error) {
    serialized.name = error.name;
    serialized.message = error.message;
    serialized.stack = error.stack;
  }
  return serialized;
};

const initializeSDK = async (config: WorkerSDKConfig) => {
  installGroupMemberRequestScheduler();
  await import(
    /* @vite-ignore */ new URL(config.wasmExecPath, self.location.href).href
  );
  const { CbEvents, getSDK } = await import("open-im-sdk-wasm");
  const sdk = getSDK({
    coreWasmPath: new URL(config.coreWasmPath, self.location.href).href,
    sqlWasmPath: new URL(config.sqlWasmPath, self.location.href).href,
  }) as unknown as Record<string, unknown>;

  new Set(Object.values(CbEvents).filter((event) => typeof event === "string")).forEach(
    (event) => {
      (sdk.on as (event: string, callback: (data: unknown) => void) => void)(
        event,
        (data) => postWorkerMessage({ type: "event", event, data }),
      );
    },
  );

  postWorkerMessage({ type: "ready" });
  return sdk;
};

workerScope.addEventListener("message", (messageEvent) => {
  const request = messageEvent.data;
  if (request.type === "init") {
    sdkPromise ??= initializeSDK(request.config);
    sdkPromise.catch((error) => {
      postWorkerMessage({ type: "fatal", error: serializeError(error) });
    });
    return;
  }

  void (async () => {
    try {
      if (!sdkPromise) throw new Error("OpenIM worker has not been initialized");
      const sdk = await sdkPromise;
      const method = sdk[request.method];
      if (typeof method !== "function") {
        throw new Error(`Unknown OpenIM SDK method: ${request.method}`);
      }
      const sdkMethod = method as (...args: unknown[]) => unknown;
      const data: unknown = await sdkMethod.apply(sdk, request.args);
      postWorkerMessage({ type: "result", requestID: request.requestID, data });
    } catch (error) {
      postWorkerMessage({
        type: "error",
        requestID: request.requestID,
        error: serializeError(error),
      });
    }
  })();
});
