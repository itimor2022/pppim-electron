import "./index.scss";
import "./i18n/index";

import log from "electron-log/renderer";
import ReactDOM from "react-dom/client";

import { isSaveLog } from "./config";

if (window.electronAPI && isSaveLog) {
  const sdkLogger = log.scope("openim-sdk-core");
  console.debug = sdkLogger.debug.bind(sdkLogger);
  const rendererLogger = log.scope("renderer");
  console.log = rendererLogger.log.bind(rendererLogger);
  console.error = rendererLogger.error.bind(rendererLogger);
}

const OPENIM_SDK_SERVICE_QUERY = "openimSdkService";

const bootstrap = async () => {
  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.get(OPENIM_SDK_SERVICE_QUERY) === "1") {
    await import("./utils/imSdkService");
    return;
  }

  const { default: App } = await import("./App");
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
  postMessage({ payload: "removeLoading" }, "*");
};

void bootstrap();
