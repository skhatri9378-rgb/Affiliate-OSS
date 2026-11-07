import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Archive,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Edit3,
  Globe2,
  LayoutDashboard,
  Link2,
  Loader2,
  Monitor,
  Plus,
  Search,
  ShieldCheck,
  Sun,
  Moon,
  Trash2,
  X,
  Layers,
} from "lucide-react";
import { snapshot, saveLabel, backupData, openLink } from "./api";
import {
  empty,
  formatDate,
  type AffiliateLink,
  type Snapshot,
  type SavedLabel,
  type Kind,
} from "./model";
import { HealthPanel } from "./HealthPanel";
import { LabelForm, LinkForm, DeleteDialog } from "./components";
import "./style.css";
type Section = "dashboard" | "links" | "manage";
export default function App() {
  const [section, setSection] = useState<Section>("dashboard");
  const [data, setData] = useState<Snapshot>(empty);
  const [search, setSearch] = useState("");
  const [countryId, setCountryId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [websiteId, setWebsiteId] = useState(
    () => localStorage.getItem("manager-project") || "",
  );
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [linkForm, setLinkForm] = useState<{ item?: AffiliateLink } | null>(
    null,
  );
  const [labelForm, setLabelForm] = useState<{
    kind: Kind;
    item?: SavedLabel;
    selectAfterSave?: boolean;
  } | null>(null);
  const [deletingLabel, setDeletingLabel] = useState<{
    kind: Kind;
    item: SavedLabel;
  } | null>(null);
  const [deleting, setDeleting] = useState<AffiliateLink | null>(null);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(
    null,
  );
  const [healthOpen, setHealthOpen] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("manager-theme") || "dark",
  );
  useEffect(() => {
    localStorage.setItem("manager-project", websiteId);
  }, [websiteId]);
  const activeProject = data.websites.find((w) => w.id === websiteId);
  const selectProject = (id: string) => {
    setWebsiteId(id);
    setCountryId("");
    setSiteId("");
    setSearch("");
    setOffset(0);
    setSection("links");
    setLoading(true);
  };
  const searchRef = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const notify = useCallback(
    (text: string, error = false) => setToast({ text, error }),
    [],
  );
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    try {
      const next = await snapshot({
        search,
        countryId,
        websiteId,
        siteId,
        offset,
      });
      if (seq === sequence.current) {
        setData(next);
        setError("");
      }
      return next;
    } catch (e) {
      if (seq === sequence.current) setError(String(e));
      throw e;
    } finally {
      if (seq === sequence.current) setLoading(false);
    }
  }, [search, countryId, websiteId, siteId, offset]);
  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => void refresh().catch(() => {}), 150);
    return () => {
      clearTimeout(t);
      ++sequence.current;
    };
  }, [refresh]);
  useEffect(() => {
    if (offset && data.total <= offset && !loading)
      setOffset(Math.max(0, Math.floor(Math.max(0, data.total - 1) / 30) * 30));
  }, [data.total, offset, loading]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("manager-theme", theme);
  }, [theme]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSection("links");
        setTimeout(() => searchRef.current?.focus(), 50);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        setLinkForm({});
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const filter = (country: string, website: string) => {
    setCountryId(country);
    setSiteId("");
    setWebsiteId(website);
    setSearch("");
    setOffset(0);
    setSection("links");
  };
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      notify("Affiliate URL copied");
    } catch {
      notify(
        "Could not access the clipboard. Please copy the URL from Edit link.",
        true,
      );
    }
  };
  const open = async (url: string) => {
    try {
      await openLink(url);
    } catch (e) {
      notify(String(e), true);
    }
  };
  const archive = async (kind: Kind, item: SavedLabel) => {
    try {
      await saveLabel(kind, item.name, item, !item.archived);
      await refresh();
      notify(
        `${item.name} ${item.archived ? "restored" : "archived"}. Its links are preserved.`,
      );
    } catch (e) {
      notify(String(e), true);
    }
  };
  const backup = async () => {
    setBackupBusy(true);
    try {
      if (await backupData()) notify("Database backup saved");
    } catch (e) {
      notify(String(e), true);
    } finally {
      setBackupBusy(false);
    }
  };
  const title =
    section === "dashboard"
      ? "Dashboard"
      : section === "links"
        ? "Affiliate Links"
        : "Manage Countries & Websites";
  const linkTable = (links: AffiliateLink[], compact = false) => (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Link name / affiliate URL</th>
            <th>Country</th>
            <th>Website</th>
            {!compact && <th>Placement</th>}
            <th>Updated</th>
            <th className="actions-heading">Actions</th>
          </tr>
        </thead>
        <tbody>
          {links.map((item) => (
            <tr key={item.id}>
              <td>
                <button
                  className="record-name"
                  onClick={() => setLinkForm({ item })}
                >
                  {item.name}
                </button>
                <div className="url-text" title={item.url}>
                  {item.url}
                </div>
                <span
                  className={`health-badge ${item.healthStatus || "unchecked"}`}
                  title={
                    item.healthCheckedAt
                      ? `${new Date(item.healthCheckedAt).toLocaleString()}${item.healthHttpStatus ? ` · HTTP ${item.healthHttpStatus}` : ""} — ${item.healthDetail || ""}`
                      : "Use Link health to check this URL."
                  }
                >
                  {item.healthStatus === "working"
                    ? "Working"
                    : item.healthStatus === "broken"
                      ? "Likely broken"
                      : item.healthStatus === "review"
                        ? "Needs review"
                        : "Not checked"}
                </span>
                {!compact && item.notes && (
                  <div className="note-preview" title={item.notes}>
                    {item.notes}
                  </div>
                )}
              </td>
              <td>
                <button
                  className="cell-tag"
                  onClick={() => filter(item.countryId, websiteId)}
                >
                  {item.countryName}
                </button>
                {!!item.countryArchived && (
                  <small className="archived-label">Archived</small>
                )}
              </td>
              <td>
                <button
                  className="website-name"
                  onClick={() => {
                    if (item.siteId) {
                      setSiteId(item.siteId);
                      setOffset(0);
                      setSection("links");
                    } else setLinkForm({ item });
                  }}
                >
                  {item.siteName || "Choose website"}
                </button>
                {!websiteId && (
                  <small className="archived-label">{item.websiteName}</small>
                )}
                {!!item.siteArchived && (
                  <small className="archived-label">Archived</small>
                )}
              </td>
              {!compact && (
                <td>
                  <span className="placement" title={item.placement}>
                    {item.placement || "—"}
                  </span>
                </td>
              )}
              <td className="date-cell">
                <span
                  title={`Created ${new Date(item.createdAt).toLocaleString()}\nUpdated ${new Date(item.updatedAt).toLocaleString()}`}
                >
                  {formatDate(item.updatedAt)}
                </span>
              </td>
              <td>
                <div className="row-actions">
                  <button
                    className="icon-button"
                    aria-label={`Copy URL for ${item.name}`}
                    title="Copy affiliate URL"
                    onClick={() => void copy(item.url)}
                  >
                    <Copy size={15} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Open ${item.name}`}
                    title="Open in browser"
                    onClick={() => void open(item.url)}
                  >
                    <ArrowUpRight size={16} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Edit ${item.name}`}
                    title="Edit link"
                    onClick={() => setLinkForm({ item })}
                  >
                    <Edit3 size={15} />
                  </button>
                  <button
                    className="icon-button delete-button"
                    aria-label={`Delete ${item.name}`}
                    title="Delete link"
                    onClick={() => setDeleting(item)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="app">
      <aside>
        <div className="brand">
          <div className="brand-mark">
            <Link2 size={21} />
          </div>
          <div>
            Affiliate Links<small>YOUR LOCAL LINK LIBRARY</small>
          </div>
        </div>
        <div className="project-switcher">
          <label htmlFor="project-switcher">CHANNEL / PROJECT</label>
          <select
            id="project-switcher"
            aria-label="Select channel or project"
            value={websiteId}
            onChange={(e) => selectProject(e.target.value)}
          >
            <option value="">All workspaces</option>
            {data.websites
              .filter((w) => !w.archived || w.id === websiteId)
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                  {w.archived ? " (archived)" : ""}
                </option>
              ))}
          </select>
          <button
            className="text-button"
            onClick={() =>
              setLabelForm({ kind: "websites", selectAfterSave: true })
            }
          >
            <Plus size={13} />
            Add channel / project
          </button>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {(
            [
              ["dashboard", "Dashboard", LayoutDashboard],
              ["links", "Affiliate Links", Link2],
              ["manage", "Manage Countries & Websites", Layers],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              className={section === id ? "active" : ""}
              onClick={() => setSection(id)}
              title={label}
            >
              <Icon size={18} />
              <span>{label}</span>
              {id === "links" && <small>{data.metrics.links}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-icon">
            <ShieldCheck size={17} />
          </div>
          <div>
            Private & local<small>Saved on this Mac</small>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            Workspace <ChevronRight size={13} />
            <strong>{title}</strong>
          </div>
          <div className="top-actions">
            <button className="button" onClick={() => setHealthOpen(true)}>
              <ShieldCheck size={15} />
              Link health
            </button>
            <button
              className="icon-button"
              aria-label={
                theme === "dark"
                  ? "Switch to light theme"
                  : "Switch to dark theme"
              }
              title="Toggle theme"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button
              className="button backup-button"
              disabled={backupBusy}
              onClick={() => void backup()}
            >
              {backupBusy ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <Download size={15} />
              )}
              <span>Back up data</span>
            </button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {activeProject
                  ? `${activeProject.name} → AFFILIATE LINKS`
                  : "CHANNEL / PROJECT → COUNTRY → AFFILIATE LINKS"}
              </div>
              <h1>{title}</h1>
              <p>
                {section === "dashboard"
                  ? activeProject
                    ? `Overview for ${activeProject.name}. Links from other channels stay separate.`
                    : "Your links, organized. Find the right one in seconds."
                  : section === "links"
                    ? activeProject
                      ? `Showing affiliate links for ${activeProject.name}.`
                      : "Every affiliate link, with the country and channel it belongs to."
                    : "Keep your saved countries and promoting websites up to date."}
              </p>
            </div>
            <button
              className="button primary add-link"
              onClick={() => setLinkForm({})}
            >
              <Plus size={16} />
              Add Link
            </button>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button
                className="button"
                onClick={() => {
                  setLoading(true);
                  void refresh().catch(() => {});
                }}
              >
                Try again
              </button>
            </div>
          )}
          {section === "dashboard" && (
            <>
              <div className="metrics">
                {(
                  [
                    [
                      "Total affiliate links",
                      data.metrics.links,
                      Link2,
                      () => setSection("links"),
                    ],
                    [
                      "Total countries",
                      data.metrics.countries,
                      Globe2,
                      () => setSection("manage"),
                    ],
                    [
                      websiteId
                        ? "Selected channel / project"
                        : "Total websites",
                      data.metrics.websites,
                      Monitor,
                      () => setSection("manage"),
                    ],
                  ] as const
                ).map(([label, count, Icon, action]) => (
                  <button className="metric" key={label} onClick={action}>
                    <span>
                      {label}
                      <Icon size={18} />
                    </span>
                    <strong>{loading ? "—" : count.toLocaleString()}</strong>
                    <small>
                      {label === "Total affiliate links"
                        ? activeProject
                          ? `Links for ${activeProject.name}`
                          : "Your complete link library"
                        : label === "Total countries"
                          ? activeProject
                            ? "Countries used by this channel / project"
                            : "Saved countries and markets"
                          : activeProject
                            ? activeProject.name
                            : "Saved promoting websites and channels"}
                    </small>
                  </button>
                ))}
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Recently added or updated</h2>
                    <p>Your latest links, ready to use</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => setSection("links")}
                  >
                    View all links <ArrowRight size={14} />
                  </button>
                </div>
                {loading ? (
                  <Loading />
                ) : data.recent.length ? (
                  linkTable(data.recent, true)
                ) : (
                  <Empty
                    title="Your link library starts here"
                    description="Save a country, add a promoting website, and keep your affiliate links together."
                    action={() => setLinkForm({})}
                    actionLabel="Add your first link"
                  />
                )}
              </section>
              {!loading &&
                !activeProject &&
                (!data.metrics.countries || !data.metrics.websites) && (
                  <div className="getting-started">
                    <div className="getting-icon">
                      <Globe2 size={21} />
                    </div>
                    <div>
                      <strong>Set up your saved options</strong>
                      <p>
                        Add your own countries and promoting websites. They’ll
                        be ready to choose whenever you add a link.
                      </p>
                    </div>
                    <button
                      className="button"
                      onClick={() => setSection("manage")}
                    >
                      Manage countries & websites <ArrowRight size={14} />
                    </button>
                  </div>
                )}
            </>
          )}
          {section === "links" && (
            <section className="panel">
              <div className="table-toolbar">
                <div className="search-box">
                  <Search size={17} />
                  <input
                    ref={searchRef}
                    aria-label="Search links"
                    placeholder="Search by link name or URL…"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setOffset(0);
                    }}
                  />
                  <kbd>⌘ K</kbd>
                </div>
                <div className="filters">
                  <select
                    aria-label="Filter by country"
                    value={countryId}
                    onChange={(e) => {
                      setCountryId(e.target.value);
                      setOffset(0);
                    }}
                  >
                    <option value="">All countries</option>
                    {data.countries.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                        {x.archived ? " (archived)" : ""}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Filter by channel/project"
                    value={websiteId}
                    onChange={(e) => {
                      setWebsiteId(e.target.value);
                      setOffset(0);
                    }}
                  >
                    <option value="">All channels / projects</option>
                    {data.websites.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                        {x.archived ? " (archived)" : ""}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Filter by website"
                    value={siteId}
                    onChange={(e) => {
                      setSiteId(e.target.value);
                      setOffset(0);
                    }}
                  >
                    <option value="">All websites</option>
                    {data.sites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                        {site.archived ? " (archived)" : ""}
                      </option>
                    ))}
                  </select>
                  {(search || countryId || websiteId || siteId) && (
                    <button
                      className="text-button clear"
                      onClick={() => filter("", "")}
                    >
                      <X size={13} />
                      Clear all
                    </button>
                  )}
                </div>
              </div>
              {(countryId || websiteId || siteId) && (
                <div className="filter-summary">
                  Showing links for{" "}
                  {countryId ? (
                    <strong>
                      {data.countries.find((c) => c.id === countryId)?.name}
                    </strong>
                  ) : (
                    "all countries"
                  )}{" "}
                  <span>→</span>{" "}
                  {websiteId ? (
                    <strong>
                      {data.websites.find((w) => w.id === websiteId)?.name}
                    </strong>
                  ) : (
                    "all channels / projects"
                  )}
                  {siteId && (
                    <>
                      <span>→</span>
                      <strong>
                        {data.sites.find((site) => site.id === siteId)?.name}
                      </strong>
                    </>
                  )}
                </div>
              )}
              {loading ? (
                <Loading />
              ) : data.links.length ? (
                linkTable(data.links)
              ) : (
                <Empty
                  title={
                    search || countryId || websiteId
                      ? "No matching links"
                      : "No affiliate links yet"
                  }
                  description={
                    search || countryId || websiteId
                      ? "Try another country or promoting website, or clear your filters."
                      : "Add your first link and assign it to a country and promoting website."
                  }
                  action={
                    search || countryId || websiteId
                      ? () => filter("", "")
                      : () => setLinkForm({})
                  }
                  actionLabel={
                    search || countryId || websiteId
                      ? "Clear filters"
                      : "Add your first link"
                  }
                />
              )}
              <div className="table-footer">
                <span>
                  {data.total
                    ? `${offset + 1}–${Math.min(offset + 30, data.total)} of ${data.total} links`
                    : "0 links"}
                </span>
                <div>
                  <button
                    className="icon-button"
                    aria-label="Previous page"
                    disabled={!offset || loading}
                    onClick={() => setOffset((v) => Math.max(0, v - 30))}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Next page"
                    disabled={offset + 30 >= data.total || loading}
                    onClick={() => setOffset((v) => v + 30)}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </section>
          )}
          {section === "manage" && (
            <Manage
              data={data}
              onEdit={(kind, item) => setLabelForm({ kind, item })}
              onDelete={(kind, item) => setDeletingLabel({ kind, item })}
              onArchive={(kind, item) => void archive(kind, item)}
              onLinks={(kind, id) => {
                if (kind === "sites") {
                  setSiteId(id);
                  setSearch("");
                  setCountryId("");
                  setOffset(0);
                  setSection("links");
                } else
                  filter(
                    kind === "countries" ? id : "",
                    kind === "websites" ? id : websiteId,
                  );
              }}
            />
          )}
          <footer>
            <span>
              <span className="local-dot" />
              Stored locally · No account or cloud required
            </span>
            <span>Affiliate Links · Simple by design</span>
          </footer>
        </main>
      </div>
      {healthOpen && (
        <HealthPanel
          data={data}
          websiteId={websiteId}
          refresh={refresh}
          onClose={() => setHealthOpen(false)}
        />
      )}
      {linkForm && (
        <LinkForm
          item={linkForm.item}
          defaultWebsiteId={
            activeProject && !activeProject.archived ? websiteId : ""
          }
          data={data}
          onClose={() => setLinkForm(null)}
          refresh={refresh}
          onSaved={async () => {
            await refresh();
            setLinkForm(null);
            notify(linkForm.item ? "Link updated" : "Link saved");
          }}
        />
      )}
      {labelForm && (
        <LabelForm
          kind={labelForm.kind}
          project={labelForm.kind === "websites"}
          item={labelForm.item}
          onClose={() => setLabelForm(null)}
          onSaved={async () => {
            const next = await refresh();
            if (labelForm.selectAfterSave) {
              const created = next.websites.find(
                (w) => !data.websites.some((old) => old.id === w.id),
              );
              if (created) selectProject(created.id);
            }
            setLabelForm(null);
            notify(labelForm.item ? "Name updated" : "Saved and ready to use");
          }}
        />
      )}
      {deletingLabel && (
        <DeleteDialog
          item={deletingLabel.item}
          kind={deletingLabel.kind}
          onClose={() => setDeletingLabel(null)}
          onDeleted={async () => {
            const { kind, item } = deletingLabel;
            if (kind === "websites" && websiteId === item.id) selectProject("");
            if (kind === "countries" && countryId === item.id) setCountryId("");
            if (kind === "sites" && siteId === item.id) setSiteId("");
            await refresh();
            setDeletingLabel(null);
            notify("Entry deleted");
          }}
        />
      )}
      {deleting && (
        <DeleteDialog
          item={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={async () => {
            await refresh();
            setDeleting(null);
            notify("Link deleted");
          }}
        />
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? "toast-error" : ""}`}
          role="status"
        >
          {toast.error ? <X size={16} /> : <Check size={16} />}
          <span>{toast.text}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
function Loading() {
  return (
    <div className="loading">
      <Loader2 className="spin" size={17} />
      Loading your links…
    </div>
  );
}
function Empty({
  title,
  description,
  action,
  actionLabel,
}: {
  title: string;
  description: string;
  action: () => void;
  actionLabel: string;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Link2 size={26} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      <button className="button primary" onClick={action}>
        <Plus size={15} />
        {actionLabel}
      </button>
    </div>
  );
}
function Manage({
  data,
  onEdit,
  onArchive,
  onDelete,
  onLinks,
}: {
  data: Snapshot;
  onEdit: (kind: Kind, item?: SavedLabel) => void;
  onDelete: (kind: Kind, item: SavedLabel) => void;
  onArchive: (kind: Kind, item: SavedLabel) => void;
  onLinks: (kind: Kind, id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  return (
    <>
      <div className="manage-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            aria-label="Search countries and websites"
            placeholder="Find a country or website…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          Show archived
        </label>
      </div>
      <div className="management-grid">
        {(["countries", "sites", "websites"] as Kind[]).map((kind) => {
          const items = data[kind].filter(
            (x) =>
              (archived || !x.archived) &&
              x.name.toLowerCase().includes(search.toLowerCase()),
          );
          return (
            <section className="panel" key={kind}>
              <div className="panel-heading">
                <div>
                  <h2>
                    {kind === "countries"
                      ? "Countries"
                      : kind === "sites"
                        ? "Websites"
                        : "Channels / projects"}{" "}
                    <span className="count">
                      {data[kind].filter((x) => !x.archived).length}
                    </span>
                  </h2>
                  <p>
                    {kind === "countries"
                      ? "The countries your pages are made for"
                      : kind === "sites"
                        ? "Websites used by your affiliate links"
                        : "Your separate channels and projects"}
                  </p>
                </div>
                <button className="button" onClick={() => onEdit(kind)}>
                  <Plus size={14} />
                  Add{" "}
                  {kind === "countries"
                    ? "country"
                    : kind === "sites"
                      ? "website"
                      : "channel/project"}
                </button>
              </div>
              {items.length ? (
                <div className="label-list">
                  {items.map((item) => (
                    <div className="label-row" key={item.id}>
                      <div
                        className={`label-avatar ${item.archived ? "is-archived" : ""}`}
                      >
                        {kind === "countries" ? (
                          <Globe2 size={18} />
                        ) : (
                          <Monitor size={18} />
                        )}
                      </div>
                      <div className="label-name">
                        <strong>{item.name}</strong>
                        <div>
                          <button
                            className="text-button"
                            onClick={() => onLinks(kind, item.id)}
                          >
                            {item.linkCount}{" "}
                            {item.linkCount === 1 ? "link" : "links"}
                          </button>
                          {item.archived && (
                            <span className="archived-tag">Archived</span>
                          )}
                        </div>
                      </div>
                      <button
                        className="icon-button"
                        aria-label={`Rename ${item.name}`}
                        title="Rename"
                        onClick={() => onEdit(kind, item)}
                      >
                        <Edit3 size={15} />
                      </button>
                      <button
                        className="button danger"
                        aria-label={`Delete ${item.name}`}
                        onClick={() => onDelete(kind, item)}
                      >
                        <Trash2 size={13} /> Delete
                      </button>
                      <button
                        className={`button ${item.archived ? "restore" : ""}`}
                        onClick={() => onArchive(kind, item)}
                      >
                        {item.archived ? (
                          "Restore"
                        ) : (
                          <>
                            <Archive size={13} />
                            Archive
                          </>
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="manage-empty">
                  <p>
                    {search
                      ? "No matches."
                      : kind === "countries"
                        ? "No active countries yet."
                        : kind === "sites"
                          ? "No active websites yet."
                          : "No active channels/projects yet."}
                  </p>
                  <button className="text-button" onClick={() => onEdit(kind)}>
                    <Plus size={13} />
                    Add{" "}
                    {kind === "countries"
                      ? "your first country"
                      : kind === "sites"
                        ? "your first website"
                        : "your first channel/project"}
                  </button>
                </div>
              )}
            </section>
          );
        })}
      </div>
      <div className="archive-note">
        <ShieldCheck size={18} />
        <p>
          <strong>Archiving keeps your links safe.</strong> Archived countries
          and websites stay attached to existing links. They’re hidden from
          new-link selections until you restore them.
        </p>
      </div>
    </>
  );
}
