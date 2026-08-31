import type { CbEvents, getSDK } from "open-im-sdk-wasm";
import type { WSEvent } from "open-im-sdk-wasm/lib/types/entity";
import type { WasmPathConfig } from "open-im-sdk-wasm/lib/types/params";

type OpenIMSDK = ReturnType<typeof getSDK>;
type ServiceSDKConfig = Required<WasmPathConfig> & { wasmExecPath: string };

type ServiceCommand =
  | { type: "init"; config: ServiceSDKConfig }
  | { type: "call"; requestID: number; method: string; args: unknown[] };

type SerializedSDKFile = {
  __openimSDKFile: true;
  name: string;
  type: string;
  size: number;
  lastModified: number;
  path?: string;
  data?: ArrayBuffer;
};

let sdkPromise: Promise<OpenIMSDK> | undefined;

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

const isSerializedSDKFile = (value: unknown): value is SerializedSDKFile => {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<SerializedSDKFile>;
  return (
    candidate.__openimSDKFile === true &&
    typeof candidate.name === "string" &&
    typeof candidate.type === "string" &&
    typeof candidate.size === "number" &&
    typeof candidate.lastModified === "number"
  );
};

const restoreSDKFileArgument = async (value: unknown): Promise<unknown> => {
  if (isSerializedSDKFile(value)) {
    let data: ArrayBuffer;
    if (value.path) {
      const diskFile = await window.electronAPI?.getFileByPath(value.path);
      if (!diskFile) {
        throw new Error(`SDK file is no longer available: ${value.name}`);
      }
      data = await diskFile.arrayBuffer();
    } else if (value.data instanceof ArrayBuffer) {
      data = value.data;
    } else {
      throw new Error(`SDK file data is missing: ${value.name}`);
    }
    if (data.byteLength !== value.size) {
      throw new Error(`SDK file size changed before upload: ${value.name}`);
    }
    return new File([data], value.name, {
      type: value.type,
      lastModified: value.lastModified,
    });
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map(restoreSDKFileArgument));
  }
  if (!value || typeof value !== "object") return value;

  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const entries = await Promise.all(
    Object.entries(value).map(async ([key, entryValue]) => [
      key,
      await restoreSDKFileArgument(entryValue),
    ]),
  );
  return Object.fromEntries(entries) as Record<string, unknown>;
};

const restoreSDKFileArguments = (args: unknown[]) =>
  Promise.all(args.map(restoreSDKFileArgument));

const emitSDKEvent = (event: CbEvents, data: WSEvent<unknown>) => {
  void window.electronAPI?.ipcInvoke("openim-sdk-service-event", {
    event,
    data,
  });
};

const initializeSDK = async (config: ServiceSDKConfig) => {
  if (typeof Reflect.get(globalThis, "Go") !== "function") {
    await import(
      /* @vite-ignore */ new URL(config.wasmExecPath, window.location.href).href
    );
  }
  const { CbEvents, getSDK } = await import("open-im-sdk-wasm");
  const sdk = getSDK({
    coreWasmPath: new URL(config.coreWasmPath, window.location.href).href,
    sqlWasmPath: new URL(config.sqlWasmPath, window.location.href).href,
  });

  new Set(Object.values(CbEvents).filter((event) => typeof event === "string")).forEach(
    (event) => {
      sdk.on(event, (data) => emitSDKEvent(event, data));
    },
  );

  return sdk;
};

const respond = (response: { requestID: number; data?: unknown; error?: unknown }) =>
  window.electronAPI?.ipcInvoke("openim-sdk-service-result", response);

const handleCommand = (command: ServiceCommand) => {
  if (command.type === "init") {
    sdkPromise ??= initializeSDK(command.config);
    sdkPromise.catch((error) => {
      console.error("OpenIM SDK service initialization failed", error);
    });
    return;
  }

  void (async () => {
    try {
      if (!sdkPromise) throw new Error("OpenIM SDK service has not been initialized");
      const sdk = await sdkPromise;
      const method = sdk[command.method as keyof OpenIMSDK];
      if (typeof method !== "function") {
        throw new Error(`Unknown OpenIM SDK method: ${command.method}`);
      }
      const args = await restoreSDKFileArguments(command.args);
      const data: unknown = await (method as (...args: unknown[]) => unknown).apply(
        sdk,
        args,
      );
      await respond({ requestID: command.requestID, data });
    } catch (error) {
      await respond({
        requestID: command.requestID,
        error: serializeError(error),
      });
    }
  })();
};

window.electronAPI?.subscribe("openim-sdk-service-command", handleCommand);
void window.electronAPI?.ipcInvoke("openim-sdk-service-ready");
