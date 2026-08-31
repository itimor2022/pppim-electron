import type { CbEvents, getSDK } from "open-im-sdk-wasm";
import type { WSEvent } from "open-im-sdk-wasm/lib/types/entity";
import type { WasmPathConfig } from "open-im-sdk-wasm/lib/types/params";

type OpenIMSDK = ReturnType<typeof getSDK>;
type SDKEventHandler = (event: WSEvent<unknown>) => void;
type WorkerSDKConfig = Required<WasmPathConfig> & { wasmExecPath: string };

type WorkerResponse =
  | { type: "ready" }
  | { type: "event"; event: CbEvents; data: WSEvent<unknown> }
  | { type: "result"; requestID: number; data: unknown }
  | { type: "error"; requestID: number; error: unknown }
  | { type: "fatal"; error: unknown };

type PendingRequest = {
  resolve: (data: unknown) => void;
  reject: (error: unknown) => void;
};

type ElectronSDKResponse = { ok: true; data: unknown } | { ok: false; error: unknown };

const sdkMethodsWithFileArguments = new Set([
  "createImageMessageByFile",
  "createSoundMessageByFile",
  "createVideoMessageByFile",
  "createFileMessageByFile",
  "uploadFile",
  "fileMapSet",
]);

type SerializedSDKFile = {
  __openimSDKFile: true;
  name: string;
  type: string;
  size: number;
  lastModified: number;
  path?: string;
  data?: ArrayBuffer;
};

const serializeSDKFileArgument = async (value: unknown): Promise<unknown> => {
  if (value instanceof File) {
    const filePath: unknown = Reflect.get(value, "path");
    const serialized: SerializedSDKFile = {
      __openimSDKFile: true,
      name: value.name,
      type: value.type,
      size: value.size,
      lastModified: value.lastModified,
    };
    if (
      typeof filePath === "string" &&
      filePath.length > 0 &&
      window.electronAPI?.fileExists(filePath)
    ) {
      serialized.path = filePath;
    } else {
      serialized.data = await value.arrayBuffer();
    }
    return serialized;
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map(serializeSDKFileArgument));
  }
  if (!value || typeof value !== "object") return value;

  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const entries = await Promise.all(
    Object.entries(value).map(async ([key, entryValue]) => [
      key,
      await serializeSDKFileArgument(entryValue),
    ]),
  );
  return Object.fromEntries(entries) as Record<string, unknown>;
};

const serializeSDKFileArguments = (args: unknown[]) =>
  Promise.all(args.map(serializeSDKFileArgument));

const createElectronSDKBridge = (config: WorkerSDKConfig): OpenIMSDK => {
  const electronAPI = window.electronAPI;
  if (!electronAPI) throw new Error("Electron API is unavailable");
  const eventHandlers = new Map<CbEvents, Set<SDKEventHandler>>();
  const unsubscribe = electronAPI.subscribe(
    "openim-sdk-event",
    ({ event, data }: { event: CbEvents; data: WSEvent<unknown> }) => {
      eventHandlers.get(event)?.forEach((handler) => handler(data));
    },
  );
  const initPromise = electronAPI.ipcInvoke("openim-sdk-init", config);

  const bridge = {
    on: (event: CbEvents, handler: SDKEventHandler) => {
      const handlers = eventHandlers.get(event) ?? new Set<SDKEventHandler>();
      handlers.add(handler);
      eventHandlers.set(event, handlers);
      return sdkProxy;
    },
    off: (event: CbEvents, handler: SDKEventHandler) => {
      eventHandlers.get(event)?.delete(handler);
      return sdkProxy;
    },
  };

  const sdkProxy = new Proxy(bridge, {
    get(_target, property) {
      if (property === "on") return bridge.on;
      if (property === "off") return bridge.off;
      if (typeof property !== "string") return undefined;
      return async (...args: unknown[]) => {
        await initPromise;
        const ipcArgs = sdkMethodsWithFileArguments.has(property)
          ? await serializeSDKFileArguments(args)
          : args;
        const response = await electronAPI.ipcInvoke<ElectronSDKResponse>(
          "openim-sdk-call",
          { method: property, args: ipcArgs },
        );
        if (!response.ok) throw response.error;
        return response.data;
      };
    },
  }) as unknown as OpenIMSDK;

  import.meta.hot?.dispose(unsubscribe);

  return sdkProxy;
};

export const createIMSDKWorkerBridge = (config: WorkerSDKConfig): OpenIMSDK => {
  if (window.electronAPI) {
    return createElectronSDKBridge(config);
  }

  const worker = new Worker(new URL("./imSdkWorker.ts", import.meta.url), {
    type: "module",
  });
  const eventHandlers = new Map<CbEvents, Set<SDKEventHandler>>();
  const pendingRequests = new Map<number, PendingRequest>();
  let requestID = 0;
  let fatalError: unknown;

  const rejectPendingRequests = (error: unknown) => {
    pendingRequests.forEach(({ reject }) => reject(error));
    pendingRequests.clear();
  };

  worker.addEventListener("message", (messageEvent: MessageEvent<WorkerResponse>) => {
    const response = messageEvent.data;
    if (response.type === "ready") return;
    if (response.type === "event") {
      eventHandlers.get(response.event)?.forEach((handler) => {
        handler(response.data);
      });
      return;
    }
    if (response.type === "fatal") {
      fatalError = response.error;
      rejectPendingRequests(response.error);
      return;
    }
    const pendingRequest = pendingRequests.get(response.requestID);
    if (!pendingRequest) return;
    pendingRequests.delete(response.requestID);
    if (response.type === "error") {
      pendingRequest.reject(response.error);
      return;
    }
    pendingRequest.resolve(response.data);
  });

  worker.addEventListener("error", (event) => {
    fatalError = new Error(event.message || "OpenIM worker failed");
    rejectPendingRequests(fatalError);
  });

  worker.postMessage({ type: "init", config });

  const bridge = {
    on: (event: CbEvents, handler: SDKEventHandler) => {
      const handlers = eventHandlers.get(event) ?? new Set<SDKEventHandler>();
      handlers.add(handler);
      eventHandlers.set(event, handlers);
      return sdkProxy;
    },
    off: (event: CbEvents, handler: SDKEventHandler) => {
      eventHandlers.get(event)?.delete(handler);
      return sdkProxy;
    },
  };

  const sdkProxy = new Proxy(bridge, {
    get(_target, property) {
      if (property === "on") return bridge.on;
      if (property === "off") return bridge.off;
      if (typeof property !== "string") return undefined;
      return (...args: unknown[]) =>
        new Promise((resolve, reject) => {
          if (fatalError) {
            reject(fatalError);
            return;
          }
          const currentRequestID = ++requestID;
          pendingRequests.set(currentRequestID, { resolve, reject });
          try {
            worker.postMessage({
              type: "call",
              requestID: currentRequestID,
              method: property,
              args,
            });
          } catch (error) {
            pendingRequests.delete(currentRequestID);
            reject(error);
          }
        });
    },
  }) as unknown as OpenIMSDK;

  import.meta.hot?.dispose(() => {
    worker.terminate();
    rejectPendingRequests(new Error("OpenIM worker was replaced by hot reload"));
  });

  return sdkProxy;
};
