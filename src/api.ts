import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Query, Snapshot, LinkInput, Kind, SavedLabel } from "./model";
export const native = isTauri();
async function request<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(
      `/api/${path}`,
      body === undefined
        ? undefined
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
    );
  } catch {
    throw Error(
      "The local server is unavailable. Start it with npm run dev, then try again.",
    );
  }
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw Error(
      result.error || "The action could not be completed. Please try again.",
    );
  }
  return response.json();
}
export const snapshot = (query: Query) =>
  native
    ? invoke<Snapshot>("manager_snapshot", { query })
    : request<Snapshot>(
        `state?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))}`,
      );
export const saveLink = (input: LinkInput) =>
  native ? invoke("manager_save_link", { input }) : request("link", input);
export const deleteLink = (id: string) =>
  native
    ? invoke("manager_delete_link", { id })
    : request("delete-link", { id });
export const deleteLabel = (kind: Kind, id: string) =>
  native
    ? invoke("manager_delete_label", { kind, id })
    : request("delete-label", { kind, id });
export const saveLabel = (
  kind: Kind,
  name: string,
  item?: SavedLabel,
  archived = item?.archived || false,
) => {
  const input = { kind, name, id: item?.id || "", archived };
  return native
    ? invoke("manager_save_label", { input })
    : request("label", input);
};
export async function backupData() {
  if (native) {
    const result = await invoke("backup_database");
    return !!result;
  }
  const response = await fetch("/api/backup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw Error("The database backup could not be created.");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Affiliate-Links-${new Date().toISOString().slice(0, 10)}.sqlite`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
export async function openLink(url: string) {
  if (native) {
    await invoke("manager_open_url", { url });
  } else window.open(url, "_blank", "noopener,noreferrer");
}

export interface HealthState {
  enabled: boolean;
  running: boolean;
  processed: number;
  total: number;
  intervalHours: number;
}
export const healthState = () => request<HealthState>("health");
export const configureHealth = (enabled: boolean) =>
  request<HealthState>("health/settings", { enabled });
export const checkLinks = (websiteId: string) =>
  request<HealthState>("health/run", { websiteId });
