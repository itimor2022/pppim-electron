// WS 10001 API 10002 CHAT 10008 CONFIG 10009

export const WS_URL = "wss://www.cliao.one/msg_gateway";
export const API_URL = "https://www.cliao.one/api";
export const CHAT_URL = "https://www.cliao.one/chat";

// export const WS_URL = "ws://14.29.213.197:50001";
// export const API_URL = "http://14.29.213.197:50002";
// export const CHAT_URL = "http://14.29.213.197:50008";

export const getWsUrl = () => localStorage.getItem("wsUrl") || WS_URL;
export const getApiUrl = () => localStorage.getItem("apiUrl") || API_URL;
export const getChatUrl = () => localStorage.getItem("chatUrl") || CHAT_URL;

export const APP_VERSION = "享聊 3.5.1";
export const APP_VERSION_CODE = 350;
export const SDK_VERSION = "SDK v3.5.1-alpha.3-e-v1.1.4";
export const CHECK_UPDATE_PREFIX =
  "https://app-1302656840.cos.ap-nanjing.myqcloud.com/";

export const isSaveLog = true;
