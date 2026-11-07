import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { Store } from "./store.mjs";
import { appServer } from "./index.mjs";
function setup(t, path = ":memory:") {
  const s = new Store(path);
  t.after(() => s.close());
  const add = (kind, name) => {
    s.saveLabel({ kind, name });
    return s.labels(kind).find((r) => r.name === name).id;
  };
  const india = add("countries", "India"),
    uk = add("countries", "UK"),
    youtube = add("websites", "YouTube"),
    blog = add("websites", "My Blog");
  const siteId = add("sites", "My website");
  return {
    s,
    india,
    uk,
    youtube,
    blog,
    link: (countryId = india, websiteId = youtube) => ({
      name: "My link",
      countryId,
      websiteId,
      siteId,
      url: "https://example.invalid/?ref=A%2Fb&sub=a+b&sub=2#keep",
      placement: "Country page",
      notes: "Private notes",
    }),
  };
}
test("starts empty without hardcoded countries or channels", (t) => {
  const s = new Store(":memory:");
  t.after(() => s.close());
  assert.deepEqual(s.snapshot().metrics, {
    links: 0,
    countries: 0,
    websites: 0,
  });
});
test("country and promoting website filters combine with AND", (t) => {
  const { s, india, uk, youtube, blog, link } = setup(t);
  s.saveLink({ ...link(), name: "India YouTube" });
  s.saveLink({ ...link(india, blog), name: "India Blog" });
  s.saveLink({ ...link(uk, youtube), name: "UK YouTube" });
  const out = s.snapshot({ countryId: india, websiteId: youtube });
  assert.equal(out.total, 1);
  assert.equal(out.links[0].name, "India YouTube");
  assert.equal(s.snapshot({ countryId: india }).total, 2);
  assert.equal(s.snapshot({ websiteId: youtube }).total, 2);
});
test("URLs, UTF-8 and creation date survive editing exactly", (t) => {
  const { s, link } = setup(t);
  const first = s.saveLink({ ...link(), name: "旅行 – 日本語" });
  const next = s.saveLink({
    ...first,
    name: "Updated",
    notes: "Line 1\nLine 2",
  });
  assert.equal(next.url, link().url);
  assert.equal(next.createdAt, first.createdAt);
  assert.equal(next.notes, "Line 1\nLine 2");
});
test("archive preserves links and supports editing existing archived associations", (t) => {
  const { s, link, india } = setup(t);
  const saved = s.saveLink(link());
  s.saveLabel({ kind: "countries", id: india, name: "India", archived: true });
  assert.equal(s.snapshot().links[0].countryArchived, 1);
  assert.equal(s.labels("countries").find((c) => c.id === india).linkCount, 1);
  assert.throws(() => s.saveLink(link()), /archived/);
  s.saveLink({ ...saved, name: "Still editable" });
  s.saveLabel({ kind: "countries", id: india, name: "India", archived: false });
  s.saveLink({ ...link(), name: "Restored country" });
  assert.equal(s.snapshot().total, 2);
});
test("website archive has the same safe behavior", (t) => {
  const { s, link, youtube } = setup(t);
  const saved = s.saveLink(link());
  s.saveLabel({
    kind: "websites",
    id: youtube,
    name: "YouTube",
    archived: true,
  });
  assert.throws(() => s.saveLink(link()), /archived/);
  s.saveLink({ ...saved, notes: "Updated while archived" });
  assert.equal(s.snapshot().total, 1);
});
test("rename retains IDs, associations and link counts", (t) => {
  const { s, link, youtube } = setup(t);
  s.saveLink(link());
  s.saveLabel({ kind: "websites", id: youtube, name: "My videos" });
  assert.equal(s.snapshot().links[0].websiteName, "My videos");
  assert.equal(s.labels("websites").find((w) => w.id === youtube).linkCount, 1);
  assert.throws(
    () => s.saveLabel({ kind: "websites", name: " my videos " }),
    /already exists/,
  );
});
test("invalid and missing input never creates partial records", (t) => {
  const { s, link } = setup(t);
  for (const patch of [
    { name: "" },
    { countryId: "" },
    { websiteId: "missing" },
    { url: "javascript:alert(1)" },
    { url: "file:///etc/passwd" },
    { url: " https://example.invalid" },
  ])
    assert.throws(() => s.saveLink({ ...link(), ...patch }));
  assert.equal(s.snapshot().total, 0);
});
test("parameterized search treats percent and underscore literally", (t) => {
  const { s, link } = setup(t);
  s.saveLink({ ...link(), name: "100%_ guaranteed" });
  s.saveLink({ ...link(), name: "Other" });
  assert.equal(s.snapshot({ search: "%_" }).total, 1);
  assert.equal(s.snapshot({ search: "' OR 1=1 --" }).total, 0);
  assert.equal(s.snapshot({ search: "A%2Fb" }).total, 2);
});
test("deletion only removes the chosen link and protects parents", (t) => {
  const { s, link, india } = setup(t);
  const a = s.saveLink(link());
  s.saveLink({ ...link(), name: "Keep" });
  assert.throws(
    () => s.db.prepare("DELETE FROM managed_countries WHERE id=?").run(india),
    /FOREIGN KEY/,
  );
  s.deleteLink(a.id);
  assert.equal(s.snapshot().total, 1);
  assert.equal(s.snapshot().metrics.countries, 2);
  assert.throws(() => s.deleteLink(a.id), /already deleted/);
});
test("records persist after reopening SQLite", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "affiliate-persist-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "app.sqlite");
  let s = new Store(path);
  s.saveLabel({ kind: "countries", name: "Japan" });
  s.close();
  s = new Store(path);
  assert.equal(s.labels("countries")[0].name, "Japan");
  s.close();
});
test("online backups include committed data and reopen correctly", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "affiliate-backup-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { s, link } = setup(t);
  s.saveLink(link());
  const path = join(dir, "backup.sqlite");
  await s.backup(path);
  const copied = new Store(path);
  assert.equal(copied.snapshot().total, 1);
  assert.equal(copied.snapshot().links[0].url, link().url);
  copied.close();
});
test("pagination retains combined filters", (t) => {
  const { s, link, india, youtube } = setup(t);
  for (let i = 0; i < 35; i++) s.saveLink({ ...link(), name: `Link ${i}` });
  const first = s.snapshot({ countryId: india, websiteId: youtube }),
    second = s.snapshot({ countryId: india, websiteId: youtube, offset: 30 });
  assert.equal(first.links.length, 30);
  assert.equal(second.links.length, 5);
  assert.equal(first.total, 35);
  assert.equal(
    new Set([...first.links, ...second.links].map((l) => l.id)).size,
    35,
  );
});
test("HTTP API rejects cross-origin writes and serves real persisted records", async (t) => {
  const { s, link } = setup(t);
  const server = appServer(s, { port: 4317 });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  let response = await fetch(base + "/api/link", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://untrusted.invalid",
    },
    body: JSON.stringify(link()),
  });
  assert.equal(response.status, 400);
  assert.equal(s.snapshot().total, 0);
  response = await fetch(base + "/api/link", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1:4317",
    },
    body: JSON.stringify(link()),
  });
  assert.equal(response.status, 200);
  assert.equal(
    (await (await fetch(base + "/api/state")).json()).metrics.links,
    1,
  );
});

test("channel workspaces isolate recent links and dashboard metrics", (t) => {
  const { s, link, india, uk, youtube, blog } = setup(t);
  s.saveLink({ ...link(india, youtube), name: "ABC crypto link" });
  s.saveLink({ ...link(uk, blog), name: "XYZ tech link" });
  const scoped = s.snapshot({ websiteId: youtube });
  assert.deepEqual(scoped.metrics, { links: 1, countries: 1, websites: 1 });
  assert.equal(scoped.recent.length, 1);
  assert.equal(scoped.recent[0].name, "ABC crypto link");
  assert.equal(scoped.links[0].websiteId, youtube);
  assert.equal(s.snapshot().metrics.links, 2);
});

test("websites and projects are independent and combine with country filtering", (t) => {
  const { s, link, india, youtube, blog } = setup(t);
  s.saveLabel({ kind: "sites", name: "Second website" });
  const second = s.labels("sites").find((w) => w.name === "Second website").id;
  const a = s.saveLink({ ...link(), name: "First website on crypto" });
  s.saveLink({ ...link(), siteId: second, name: "Second website on crypto" });
  s.saveLink({ ...link(india, blog), name: "First website on tech" });
  const results = s.snapshot({
    websiteId: youtube,
    siteId: a.siteId,
    countryId: india,
  });
  assert.equal(results.total, 1);
  assert.equal(results.links[0].siteName, "My website");
  assert.equal(results.links[0].websiteName, "YouTube");
  assert.notEqual(a.siteId, a.websiteId);
  assert.equal(s.snapshot({ siteId: a.siteId }).total, 2);
  s.saveLabel({
    kind: "sites",
    id: a.siteId,
    name: "Renamed website",
    archived: true,
  });
  assert.throws(
    () => s.saveLink({ ...link(), name: "New for archived website" }),
    /archived/,
  );
  s.saveLink({ ...a, notes: "Existing link stays editable" });
  assert.equal(s.snapshot({ websiteId: youtube }).total, 2);
});
test("migration preserves old channel associations and leaves the new website unassigned", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "affiliate-migration-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "app.sqlite");
  const old = new DatabaseSync(path);
  old.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  old
    .prepare("INSERT INTO managed_countries VALUES(?,?,?,?,?)")
    .run("country", "India", 0, "2026-10-18", "2026-10-18");
  old
    .prepare("INSERT INTO promoting_websites VALUES(?,?,?,?,?)")
    .run("project", "income365", 0, "2026-10-18", "2026-10-18");
  old
    .prepare("INSERT INTO managed_links VALUES(?,?,?,?,?,?,?,?,?)")
    .run(
      "original",
      "App",
      "country",
      "project",
      "India page",
      "https://example.invalid/?ref=A%2Fb",
      "Keep notes",
      "2026-10-18",
      "2026-10-18",
    );
  old.close();
  const migrated = new Store(path);
  const row = migrated.snapshot().links[0];
  assert.equal(row.id, "original");
  assert.equal(row.websiteId, "project");
  assert.equal(row.websiteName, "income365");
  assert.equal(row.siteId, null);
  assert.equal(row.siteName, null);
  assert.equal(row.notes, "Keep notes");
  assert.equal(row.url, "https://example.invalid/?ref=A%2Fb");
  assert.equal(migrated.labels("sites").length, 0);
  migrated.close();
  assert.equal(
    readdirSync(dir).filter((n) => n.includes("before-websites")).length,
    1,
  );
  const again = new Store(path);
  assert.equal(again.snapshot().total, 1);
  again.close();
  assert.equal(
    readdirSync(dir).filter((n) => n.includes("before-websites")).length,
    1,
  );
});

test("delete categories only when unused and preserve associated links", (t) => {
  const { s, india, youtube, link } = setup(t);
  const input = link();
  s.saveLink(input);
  for (const [kind, id] of [
    ["countries", india],
    ["websites", youtube],
    ["sites", input.siteId],
  ]) {
    assert.throws(() => s.deleteLabel({ kind, id }), /Move or delete/);
    assert.ok(s.labels(kind).some((x) => x.id === id));
    s.saveLabel({ kind, name: "Unused", archived: true });
    const unused = s.labels(kind).find((x) => x.name === "Unused");
    s.deleteLabel({ kind, id: unused.id });
    assert.ok(!s.labels(kind).some((x) => x.id === unused.id));
    assert.throws(
      () => s.deleteLabel({ kind, id: unused.id }),
      /no longer exists/,
    );
  }
  assert.equal(s.snapshot({}).total, 1);
  assert.throws(() => s.deleteLabel({ kind: "invalid", id: india }));
});
