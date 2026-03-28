// WS 10001 API 10002 CHAT 10008 CONFIG 10009

// export const WS_URL = "ws://admin.skjdffsdfs.top/msg_gateway_enterprise";
// export const API_URL = "http://admin.skjdffsdfs.top/api_enterprise";
// export const CHAT_URL = "http://admin.skjdffsdfs.top/chat_enterprise";

// export const WS_URL = "wss://134.122.133.152/msg_gateway";
// export const API_URL = "https://134.122.133.152/api";
// export const CHAT_URL = "https://134.122.133.152/chat";
const origin = typeof window !== 'undefined' ? window.location.origin : '';
const host = typeof window !== 'undefined' ? window.location.host : '127.0.0.1';

export const WS_URL =
  typeof window !== 'undefined' && window.location.protocol.startsWith('http')
    ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${host}/msg_gateway`
    : 'ws://45.207.197.18:10001';
export const API_URL =
  typeof window !== 'undefined' && window.location.protocol.startsWith('http')
    ? `${origin}/api`
    : 'http://45.207.197.18:10002';
export const CHAT_URL =
  typeof window !== 'undefined' && window.location.protocol.startsWith('http')
    ? `${origin}/chat`
    : 'http://45.207.197.18:10008';
export const getWsUrl = () => localStorage.getItem("wsUrl") || WS_URL;
export const getApiUrl = () => localStorage.getItem("apiUrl") || API_URL;
export const getChatUrl = () => localStorage.getItem("chatUrl") || CHAT_URL;

export const APP_VERSION = "享聊 v1.0";
export const APP_VERSION_CODE = 550;
export const SDK_VERSION = "SDK v1.0.1";
export const CHECK_UPDATE_PREFIX =
  "https://app-1302656840.cos.ap-nanjing.myqcloud.com/";

export const isSaveLog = true;
