import { useState, useEffect, type ReactNode } from "react";
import { countryOptions } from "./countries";
import { Dialog, AlertDialog } from "radix-ui";
import { X, Check, Plus, Loader2 } from "lucide-react";
import { saveLink, saveLabel, deleteLink, deleteLabel } from "./api";
import {
  blankLink,
  linkSchema,
  type AffiliateLink,
  type SavedLabel,
  type Kind,
  type Snapshot,
} from "./model";
export function Modal({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="modal">
          <header>
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>{description}</Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="Close dialog">
              <X size={18} />
            </Dialog.Close>
          </header>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function LabelForm({
  project = false,
  kind,
  item,
  onClose,
  onSaved,
}: {
  project?: boolean;
  kind: Kind;
  item?: SavedLabel;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(item?.name || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const noun =
    kind === "countries" ? "country" : project ? "channel/project" : "website";
  return (
    <Modal
      title={`${item ? "Rename" : "Add"} ${noun}`}
      description={
        kind === "countries"
          ? "Use any country or market name that fits your pages."
          : project
            ? "Add a channel or project. Websites are managed separately."
            : "Add the website name. This is separate from your channel/project."
      }
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await saveLabel(kind, name, item);
            await onSaved();
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-body">
          <Field label="Name">
            <input
              autoFocus
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                kind === "countries"
                  ? "Country name"
                  : "Website or channel name"
              }
            />
          </Field>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="form-actions">
          <button className="button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button disabled={busy} className="button primary">
            {busy ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <Check size={15} />
            )}
            Save{" "}
            {kind === "countries"
              ? "country"
              : project
                ? "channel/project"
                : "website"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function LinkForm({
  defaultWebsiteId = "",
  item,
  data,
  onClose,
  onSaved,
  refresh,
}: {
  defaultWebsiteId?: string;
  item?: AffiliateLink;
  data: Snapshot;
  onClose: () => void;
  onSaved: () => Promise<void>;
  refresh: () => Promise<Snapshot>;
}) {
  const [value, setValue] = useState(() =>
    item
      ? { ...item, siteId: item.siteId || "" }
      : { ...blankLink(), websiteId: defaultWebsiteId },
  );
  const [local, setLocal] = useState(data);
  const [inline, setInline] = useState<Kind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [countryBusy, setCountryBusy] = useState(false);
  useEffect(() => setLocal(data), [data]);
  const chooseCountry = async (id: string) => {
    if (!id.startsWith("catalog:")) {
      patch("countryId", id);
      return;
    }
    const country = countryOptions.find((c) => "catalog:" + c.code === id);
    if (!country) return;
    setCountryBusy(true);
    setError("");
    try {
      await saveLabel("countries", country.name);
      const next = await refresh();
      setLocal(next);
      const saved = next.countries.find(
        (c) =>
          c.name.toLowerCase() === country.name.toLowerCase() && !c.archived,
      );
      if (!saved)
        throw Error("The country could not be loaded. Please try again.");
      patch("countryId", saved.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setCountryBusy(false);
    }
  };
  const patch = (key: string, next: string) =>
    setValue((v) => ({ ...v, [key]: next }));
  const submit = async () => {
    const result = linkSchema.safeParse(value);
    if (!result.success) {
      setError(result.error.issues.map((i) => i.message).join(" "));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await saveLink(value);
      await onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Modal
        title={item ? "Edit affiliate link" : "Add affiliate link"}
        description="Save an affiliate URL for a website within your selected channel/project."
        onClose={onClose}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "s") {
              e.preventDefault();
              void submit();
            }
          }}
        >
          <div className="form-body">
            <Field label="App name *">
              <input
                autoFocus
                required
                maxLength={200}
                placeholder="Enter the app name"
                value={value.name}
                onChange={(e) => patch("name", e.target.value)}
              />
            </Field>
            <Field
              label="Channel / project *"
              hint={
                defaultWebsiteId && !item
                  ? "Selected from the sidebar. Choose a different workspace there to add links for another channel."
                  : undefined
              }
            >
              <select
                required
                aria-label="Channel / project *"
                value={value.websiteId}
                disabled={!!defaultWebsiteId && !item}
                onChange={(e) => patch("websiteId", e.target.value)}
              >
                <option value="">Select channel/project</option>
                {local.websites
                  .filter((w) => !w.archived || w.id === item?.websiteId)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                      {w.archived ? " (archived)" : ""}
                    </option>
                  ))}
              </select>
            </Field>
            <div className="form-grid">
              {(["countries", "sites"] as Kind[]).map((kind) => {
                const key = kind === "countries" ? "countryId" : "siteId";
                const label = kind === "countries" ? "Country" : "Website";
                const choices = local[kind].filter(
                  (x) => !x.archived || x.id === item?.[key],
                );
                return (
                  <div key={kind}>
                    <Field label={`${label} *`}>
                      <select
                        required
                        value={value[key] || ""}
                        disabled={kind === "countries" && countryBusy}
                        onChange={(e) => {
                          if (kind === "countries")
                            void chooseCountry(e.target.value);
                          else patch(key, e.target.value);
                        }}
                      >
                        <option value="">
                          Select {kind === "countries" ? "country" : "website"}
                        </option>
                        {choices.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                            {x.archived ? " (archived)" : ""}
                          </option>
                        ))}
                        {kind === "countries" && (
                          <optgroup label="Other countries">
                            {countryOptions
                              .filter(
                                (country) =>
                                  !local.countries.some(
                                    (saved) =>
                                      saved.name.toLowerCase() ===
                                      country.name.toLowerCase(),
                                  ),
                              )
                              .map((country) => (
                                <option
                                  key={country.code}
                                  value={"catalog:" + country.code}
                                >
                                  {country.name}
                                </option>
                              ))}
                          </optgroup>
                        )}
                      </select>
                    </Field>
                    {kind === "countries" && countryBusy && (
                      <small className="muted">Saving country…</small>
                    )}
                    <button
                      type="button"
                      className="text-button inline-add"
                      onClick={() => setInline(kind)}
                    >
                      <Plus size={12} />
                      Add {kind === "countries" ? "country" : "website"}
                    </button>
                  </div>
                );
              })}
            </div>
            {(item?.countryArchived ||
              item?.websiteArchived ||
              item?.siteArchived) && (
              <p className="hint-box">
                An associated entry is archived. You can keep this link assigned
                to it or choose an active entry.
              </p>
            )}
            <Field
              label="Affiliate URL *"
              hint="Saved exactly as entered, including every referral code and tracking parameter."
            >
              <input
                required
                spellCheck={false}
                type="text"
                inputMode="url"
                placeholder="https://"
                value={value.url}
                onChange={(e) => patch("url", e.target.value)}
              />
            </Field>
            <Field
              label="My country page or placement"
              hint="Optional: a country-page URL, page name, or placement label."
            >
              <input
                placeholder="Where this link belongs on your website"
                value={value.placement}
                maxLength={2000}
                onChange={(e) => patch("placement", e.target.value)}
              />
            </Field>
            <Field label="Notes">
              <textarea
                rows={3}
                maxLength={20000}
                placeholder="Anything useful to remember (optional)"
                value={value.notes}
                onChange={(e) => patch("notes", e.target.value)}
              />
            </Field>
            {item && (
              <p className="form-timestamps">
                Created {new Date(item.createdAt).toLocaleString()} · Updated{" "}
                {new Date(item.updatedAt).toLocaleString()}
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="form-actions">
            <small className="muted">⌘ S to save</small>
            <button type="button" className="button" onClick={onClose}>
              Cancel
            </button>
            <button className="button primary" disabled={busy || countryBusy}>
              {busy ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <Check size={15} />
              )}
              Save link
            </button>
          </div>
        </form>
      </Modal>
      {inline && (
        <LabelForm
          kind={inline}
          project={inline === "websites"}
          onClose={() => setInline(null)}
          onSaved={async () => {
            const next = await refresh();
            setLocal(next);
            const created = next[inline].filter(
              (x) => !local[inline].some((y) => y.id === x.id),
            )[0];
            if (created)
              patch(
                inline === "countries"
                  ? "countryId"
                  : inline === "sites"
                    ? "siteId"
                    : "websiteId",
                created.id,
              );
            setInline(null);
          }}
        />
      )}
    </>
  );
}
export function DeleteDialog({
  item,
  kind,
  onClose,
  onDeleted,
}: {
  item: Pick<AffiliateLink, "id" | "name">;
  kind?: Kind;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <AlertDialog.Root open onOpenChange={(open) => !open && onClose()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="overlay" />
        <AlertDialog.Content className="modal confirm">
          <AlertDialog.Title>Delete “{item.name}”?</AlertDialog.Title>
          <AlertDialog.Description>
            {kind
              ? "This permanently deletes this saved entry. Move or delete its links first, or use Archive to preserve them."
              : "This permanently deletes this link. Your saved countries, websites and projects remain."}{" "}
            This action cannot be undone.
          </AlertDialog.Description>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <AlertDialog.Cancel className="button" disabled={busy}>
              Cancel
            </AlertDialog.Cancel>
            <button
              className="button danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await (kind
                    ? deleteLabel(kind, item.id)
                    : deleteLink(item.id));
                  await onDeleted();
                } catch (e) {
                  setError(String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Loader2 size={15} className="spin" /> : null}Delete{" "}
              {kind ? "entry" : "link"}
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
