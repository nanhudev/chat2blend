export type ProviderId = "chatgpt" | "generic_dom" | "unknown";

export interface Settings {
  port: number;
  token: string;
  autoExecute: boolean;
  provider: ProviderId;
}

export const DEFAULT_SETTINGS: Settings = {
  port: 8787,
  token: "",
  autoExecute: false,
  provider: "unknown",
};

/** content script -> service worker */
export type ToBackground =
  | { type: "c2b/hello"; provider: string }
  | { type: "c2b/job/new"; provider: string; title: string }
  | { type: "c2b/chunk"; name: string; index: number; code: string; final?: boolean }
  | { type: "c2b/generation-done"; reason: "complete" | "stopped" }
  | { type: "c2b/ping" };

/** service worker -> popup */
export interface BridgeSnapshot {
  ok: boolean;
  bridgeUp: boolean;
  blenderConnected: boolean;
  blenderVersion?: string;
  addonVersion?: string;
  autoExecute: boolean;
  paired: boolean;
  provider: string;
  job?: {
    id: string;
    status: string;
    title?: string;
    chunks: { name: string; status: string; error?: string }[];
  };
  error?: string;
}
