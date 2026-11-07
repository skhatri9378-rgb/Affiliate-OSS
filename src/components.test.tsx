// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LinkForm, DeleteDialog } from "./components";
import App from "./App";
import { empty, type Snapshot, type AffiliateLink } from "./model";
import * as api from "./api";
vi.mock("./api", () => ({
  saveLink: vi.fn(async () => ({})),
  saveLabel: vi.fn(async () => ({})),
  deleteLink: vi.fn(async () => ({})),
  snapshot: vi.fn(),
  backupData: vi.fn(),
  openLink: vi.fn(),
}));
const label = (id: string, name: string, archived = false) => ({
  id,
  name,
  archived,
  linkCount: 0,
  createdAt: "2026-10-18T12:00:00Z",
  updatedAt: "2026-10-18T12:00:00Z",
});
const data: Snapshot = {
  ...empty,
  countries: [
    label("in", "India"),
    label("uk", "UK"),
    label("old", "Old market", true),
  ],
  websites: [label("yt", "YouTube"), label("blog", "My Blog")],
  sites: [label("site", "My website")],
  metrics: { links: 0, countries: 3, websites: 2 },
};
const item: AffiliateLink = {
  id: "link",
  name: "Saved link",
  countryId: "in",
  websiteId: "yt",
  siteId: "site",
  siteName: "My website",
  countryName: "India",
  websiteName: "YouTube",
  url: "https://example.invalid/?ref=A%2Fb&sub=1+2",
  placement: "India page",
  notes: "Private",
  createdAt: "2026-10-18T12:00:00Z",
  updatedAt: "2026-10-18T12:00:00Z",
  countryArchived: false,
  websiteArchived: false,
};
afterEach(() => {
  cleanup();
  localStorage.removeItem("manager-project");
  vi.clearAllMocks();
});
describe("simple link workflows", () => {
  it("saves a link with one country and website while preserving the original URL", async () => {
    const user = userEvent.setup();
    const done = vi.fn(async () => {});
    render(
      <LinkForm
        data={data}
        onClose={() => {}}
        refresh={async () => data}
        onSaved={done}
      />,
    );
    await user.type(screen.getByLabelText("App name *"), "My referral");
    await user.selectOptions(screen.getByLabelText("Country *"), "in");
    await user.selectOptions(
      screen.getByLabelText("Channel / project *"),
      "yt",
    );
    await user.selectOptions(screen.getByLabelText("Website *"), "site");
    await user.type(screen.getByLabelText(/Affiliate URL/), item.url);
    await user.click(screen.getByRole("button", { name: "Save link" }));
    expect(api.saveLink).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "My referral",
        countryId: "in",
        websiteId: "yt",
        url: item.url,
      }),
    );
    expect(done).toHaveBeenCalled();
  });
  it("hides archived choices for new links but keeps them available on existing links", () => {
    const rendered = render(
      <LinkForm
        data={data}
        onClose={() => {}}
        refresh={async () => data}
        onSaved={async () => {}}
      />,
    );
    expect(
      screen.queryByRole("option", { name: "Old market (archived)" }),
    ).toBeNull();
    rendered.unmount();
    render(
      <LinkForm
        item={{ ...item, countryId: "old", countryArchived: true }}
        data={data}
        onClose={() => {}}
        refresh={async () => data}
        onSaved={async () => {}}
      />,
    );
    expect(
      screen.getByRole("option", { name: "Old market (archived)" }),
    ).toBeTruthy();
  });
  it("creates a country inline and preserves the unfinished link name", async () => {
    const user = userEvent.setup();
    const next = {
      ...data,
      countries: [...data.countries, label("jp", "Japan")],
    };
    render(
      <LinkForm
        data={data}
        onClose={() => {}}
        refresh={async () => next}
        onSaved={async () => {}}
      />,
    );
    await user.type(screen.getByLabelText("App name *"), "Keep my draft");
    await user.click(screen.getByRole("button", { name: "Add country" }));
    await user.type(screen.getByLabelText("Name", { exact: true }), "Japan");
    await user.click(screen.getByRole("button", { name: "Save country" }));
    expect(await screen.findByDisplayValue("Keep my draft")).toBeTruthy();
    expect(
      (screen.getByLabelText("Country *") as HTMLSelectElement).value,
    ).toBe("jp");
  });
  it("does not delete a link until confirmation is chosen", async () => {
    const user = userEvent.setup();
    render(
      <DeleteDialog
        item={item}
        onClose={() => {}}
        onDeleted={async () => {}}
      />,
    );
    expect(api.deleteLink).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete link" }));
    expect(api.deleteLink).toHaveBeenCalledWith("link");
  });
  it("sends country and website filters together and clears them together", async () => {
    vi.mocked(api.snapshot).mockImplementation(async (query) => ({
      ...data,
      links: query.countryId && query.websiteId ? [item] : [],
      total: query.countryId && query.websiteId ? 1 : 0,
    }));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Total affiliate links");
    await user.click(screen.getByRole("button", { name: /Affiliate Links/ }));
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "India" })).toBeTruthy(),
    );
    await user.selectOptions(screen.getByLabelText("Filter by country"), "in");
    await user.selectOptions(
      screen.getByLabelText("Filter by channel/project"),
      "yt",
    );
    await waitFor(() =>
      expect(api.snapshot).toHaveBeenLastCalledWith({
        search: "",
        siteId: "",
        countryId: "in",
        websiteId: "yt",
        offset: 0,
      }),
    );
    await screen.findByText("Saved link");
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    await waitFor(() =>
      expect(api.snapshot).toHaveBeenLastCalledWith({
        search: "",
        siteId: "",
        countryId: "",
        websiteId: "",
        offset: 0,
      }),
    );
  });
});

describe("offline country selector", () => {
  it("offers standard countries in an empty workspace and saves a selected country", async () => {
    const user = userEvent.setup();
    const next = { ...empty, countries: [label("saved-in", "India")] };
    render(
      <LinkForm
        data={empty}
        onClose={() => {}}
        refresh={async () => next}
        onSaved={async () => {}}
      />,
    );
    expect(screen.getByRole("option", { name: "India" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "United Kingdom" })).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Country *"), "catalog:IN");
    await waitFor(() =>
      expect(api.saveLabel).toHaveBeenCalledWith("countries", "India"),
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Country *") as HTMLSelectElement).value,
      ).toBe("saved-in"),
    );
  });
  it("updates saved options when the initial database response arrives after opening the form", () => {
    const props = {
      onClose: () => {},
      refresh: async () => data,
      onSaved: async () => {},
    };
    const view = render(<LinkForm data={empty} {...props} />);
    view.rerender(<LinkForm data={data} {...props} />);
    expect(
      (screen.getByRole("option", { name: "India" }) as HTMLOptionElement)
        .value,
    ).toBe("in");
  });
  it("does not reoffer an archived standard country through the reference list", () => {
    render(
      <LinkForm
        data={{ ...empty, countries: [label("archived-in", "India", true)] }}
        onClose={() => {}}
        refresh={async () => empty}
        onSaved={async () => {}}
      />,
    );
    expect(screen.queryByRole("option", { name: "India" })).toBeNull();
  });
});

describe("channel and project workspaces", () => {
  it("switches the link list and defaults a new link to the selected project", async () => {
    vi.mocked(api.snapshot).mockImplementation(async (query) => ({
      ...data,
      links: query.websiteId === "yt" ? [item] : [],
      total: query.websiteId === "yt" ? 1 : 0,
    }));
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() =>
      expect(
        screen
          .getByLabelText("Select channel or project")
          .querySelector('option[value="yt"]'),
      ).toBeTruthy(),
    );
    await user.selectOptions(
      screen.getByLabelText("Select channel or project"),
      "yt",
    );
    await waitFor(() =>
      expect(api.snapshot).toHaveBeenLastCalledWith({
        search: "",
        siteId: "",
        countryId: "",
        websiteId: "yt",
        offset: 0,
      }),
    );
    await screen.findByText("Showing affiliate links for YouTube.");
    await user.click(screen.getByRole("button", { name: "Add Link" }));
    expect(
      (screen.getByLabelText("Channel / project *") as HTMLSelectElement).value,
    ).toBe("yt");
  });
  it("creates a separate channel or project from the sidebar and selects it automatically", async () => {
    let created = false;
    vi.mocked(api.snapshot).mockImplementation(async () => ({
      ...data,
      websites: created
        ? [...data.websites, label("crypto", "ABC — Crypto")]
        : data.websites,
    }));
    vi.mocked(api.saveLabel).mockImplementationOnce(async () => {
      created = true;
      return {};
    });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() =>
      expect(
        screen
          .getByLabelText("Select channel or project")
          .querySelector('option[value="yt"]'),
      ).toBeTruthy(),
    );
    await user.click(
      screen.getByRole("button", { name: "Add channel / project" }),
    );
    await user.type(screen.getByLabelText("Name"), "ABC — Crypto");
    await user.click(
      screen.getByRole("button", { name: "Save channel/project" }),
    );
    await waitFor(() =>
      expect(
        (
          screen.getByLabelText(
            "Select channel or project",
          ) as HTMLSelectElement
        ).value,
      ).toBe("crypto"),
    );
    await screen.findByText("Showing affiliate links for ABC — Crypto.");
  });
});

describe("separate websites within a channel/project", () => {
  it("keeps the selected project separate and creates a website inline without losing the draft", async () => {
    const user = userEvent.setup();
    const next = {
      ...data,
      sites: [...data.sites, label("new-site", "Crypto Insights")],
    };
    render(
      <LinkForm
        data={data}
        defaultWebsiteId="yt"
        onClose={() => {}}
        refresh={async () => next}
        onSaved={async () => {}}
      />,
    );
    const project = screen.getByLabelText(
      "Channel / project *",
    ) as HTMLSelectElement;
    expect(project.value).toBe("yt");
    expect(project.disabled).toBe(true);
    const website = screen.getByLabelText("Website *") as HTMLSelectElement;
    expect(website.value).toBe("");
    expect(website.querySelector('option[value="yt"]')).toBeNull();
    await user.type(screen.getByLabelText("App name *"), "Keep this app");
    await user.click(screen.getByRole("button", { name: "Add website" }));
    await user.type(screen.getByLabelText("Name"), "Crypto Insights");
    await user.click(screen.getByRole("button", { name: "Save website" }));
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Website *") as HTMLSelectElement).value,
      ).toBe("new-site"),
    );
    expect(
      (screen.getByLabelText("Channel / project *") as HTMLSelectElement).value,
    ).toBe("yt");
    expect(screen.getByDisplayValue("Keep this app")).toBeTruthy();
    expect(api.saveLabel).toHaveBeenCalledWith(
      "sites",
      "Crypto Insights",
      undefined,
    );
  });
});
