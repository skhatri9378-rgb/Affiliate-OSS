// @vitest-environment jsdom
import { afterEach, it, expect, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HealthPanel } from "./HealthPanel";
import { empty } from "./model";
import * as api from "./api";
const off = {
  enabled: false,
  running: false,
  processed: 0,
  total: 0,
  intervalHours: 24,
};
vi.mock("./api", () => ({
  native: false,
  healthState: vi.fn(),
  configureHealth: vi.fn(),
  checkLinks: vi.fn(),
  openLink: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("explains tracking activity before enabling persisted daily checks", async () => {
  vi.mocked(api.healthState).mockResolvedValue(off);
  vi.mocked(api.configureHealth).mockResolvedValue({ ...off, enabled: true });
  const user = userEvent.setup();
  render(
    <HealthPanel
      data={empty}
      websiteId=""
      refresh={async () => empty}
      onClose={() => {}}
    />,
  );
  expect(screen.getByText(/may register tracking activity/)).toBeTruthy();
  const button = screen.getByRole("button", { name: "Enable daily checks" });
  await waitFor(() =>
    expect((button as HTMLButtonElement).disabled).toBe(false),
  );
  await user.click(button);
  expect(api.configureHealth).toHaveBeenCalledWith(true);
  await screen.findByRole("button", { name: "Turn off" });
});
it("checks only the selected channel on demand", async () => {
  vi.mocked(api.healthState).mockResolvedValue(off);
  vi.mocked(api.checkLinks).mockResolvedValue({
    ...off,
    running: true,
    total: 2,
  });
  const user = userEvent.setup();
  render(
    <HealthPanel
      data={empty}
      websiteId="crypto-channel"
      refresh={async () => empty}
      onClose={() => {}}
    />,
  );
  const button = screen.getByRole("button", { name: "Check now" });
  await waitFor(() =>
    expect((button as HTMLButtonElement).disabled).toBe(false),
  );
  await user.click(button);
  expect(api.checkLinks).toHaveBeenCalledWith("crypto-channel");
  await screen.findByText(/Checking 0 of 2/);
});
