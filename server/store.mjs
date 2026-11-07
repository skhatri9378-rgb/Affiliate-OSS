import { DatabaseSync, backup } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
export const linkSelect = `SELECT l.id,l.name,l.country_id AS countryId,l.promoting_website_id AS websiteId,l.placement,l.affiliate_url AS url,l.notes,l.created_at AS createdAt,l.updated_at AS updatedAt,c.name AS countryName,w.name AS websiteName,c.archived AS countryArchived,w.archived AS websiteArchived,h.outcome AS healthStatus,h.checked_at AS healthCheckedAt,h.http_status AS healthHttpStatus,h.detail AS healthDetail,l.placement_website_id AS siteId,s.name AS siteName,s.archived AS siteArchived FROM managed_links l JOIN managed_countries c ON c.id=l.country_id JOIN promoting_websites w ON w.id=l.promoting_website_id LEFT JOIN link_health h ON h.link_id=l.id AND h.checked_url=l.affiliate_url LEFT JOIN placement_websites s ON s.id=l.placement_website_id`;
export class Store {
  constructor(path) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      readFileSync(new URL("./schema.sql", import.meta.url), "utf8"),
    );
    const columns = this.db.prepare("PRAGMA table_info(managed_links)").all();
    if (!columns.some((c) => c.name === "placement_website_id")) {
      if (path !== ":memory:")
        this.db
          .prepare("VACUUM INTO ?")
          .run(`${path}.before-websites-${Date.now()}.sqlite`);
      this.transaction(() => {
        this.db.exec(
          "ALTER TABLE managed_links ADD COLUMN placement_website_id TEXT REFERENCES placement_websites(id) ON DELETE RESTRICT; CREATE INDEX IF NOT EXISTS manager_link_site ON managed_links(placement_website_id); INSERT OR IGNORE INTO manager_migrations VALUES(3,datetime('now'));",
        );
      });
    }
  }
  close() {
    this.db.close();
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  table(kind) {
    if (kind === "countries") return "managed_countries";
    if (kind === "websites") return "promoting_websites";
    if (kind === "sites") return "placement_websites";
    throw Error("Unknown category");
  }
  labels(kind) {
    const table = this.table(kind);
    const fk =
      kind === "countries"
        ? "country_id"
        : kind === "sites"
          ? "placement_website_id"
          : "promoting_website_id";
    return this.db
      .prepare(
        `SELECT t.id,t.name,t.archived,t.created_at AS createdAt,t.updated_at AS updatedAt,(SELECT count(*) FROM managed_links l WHERE l.${fk}=t.id) AS linkCount FROM ${table} t ORDER BY t.archived,t.name COLLATE NOCASE,t.id`,
      )
      .all()
      .map((x) => ({ ...x, archived: !!x.archived }));
  }
  snapshot(query = {}) {
    const where = [];
    const params = [];
    if (query.search?.trim()) {
      where.push(
        "(l.name LIKE ? ESCAPE '\\' OR l.affiliate_url LIKE ? ESCAPE '\\')",
      );
      const value = `%${query.search.trim().replace(/[\\%_]/g, "\\$&")}%`;
      params.push(value, value);
    }
    if (query.countryId) {
      where.push("l.country_id=?");
      params.push(query.countryId);
    }
    if (query.websiteId) {
      where.push("l.promoting_website_id=?");
      params.push(query.websiteId);
    }
    if (query.siteId) {
      where.push("l.placement_website_id=?");
      params.push(query.siteId);
    }
    const condition = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const offset = Math.max(0, Math.min(Number(query.offset) || 0, 1e9));
    const total = this.db
      .prepare(`SELECT count(*) AS n FROM managed_links l${condition}`)
      .get(...params).n;
    const links = this.db
      .prepare(
        `${linkSelect}${condition} ORDER BY l.updated_at DESC,l.id LIMIT 30 OFFSET ?`,
      )
      .all(...params, offset);
    const projectParams = query.websiteId ? [query.websiteId] : [];
    const projectWhere = query.websiteId ? " WHERE promoting_website_id=?" : "";
    const metrics = {
      links: this.db
        .prepare(`SELECT count(*) AS n FROM managed_links${projectWhere}`)
        .get(...projectParams).n,
      countries: query.websiteId
        ? this.db
            .prepare(
              "SELECT count(DISTINCT country_id) AS n FROM managed_links WHERE promoting_website_id=?",
            )
            .get(query.websiteId).n
        : this.db.prepare("SELECT count(*) AS n FROM managed_countries").get()
            .n,
      websites: query.websiteId
        ? this.db
            .prepare(
              "SELECT count(DISTINCT placement_website_id) AS n FROM managed_links WHERE promoting_website_id=?",
            )
            .get(query.websiteId).n
        : this.db.prepare("SELECT count(*) AS n FROM placement_websites").get()
            .n,
    };
    return {
      countries: this.labels("countries"),
      websites: this.labels("websites"),
      sites: this.labels("sites"),
      links,
      total,
      metrics,
      recent: this.db
        .prepare(
          `${linkSelect}${query.websiteId ? " WHERE l.promoting_website_id=?" : ""} ORDER BY l.updated_at DESC,l.id LIMIT 6`,
        )
        .all(...projectParams),
    };
  }
  deleteLabel({ kind, id }) {
    const table = this.table(kind);
    const fk =
      kind === "countries"
        ? "country_id"
        : kind === "sites"
          ? "placement_website_id"
          : "promoting_website_id";
    return this.transaction(() => {
      if (
        this.db
          .prepare(`SELECT 1 FROM managed_links WHERE ${fk}=? LIMIT 1`)
          .get(id)
      )
        throw Error(
          "Move or delete this entry’s links first, or archive it to keep them.",
        );
      if (!this.db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id).changes)
        throw Error("This entry no longer exists. Refresh and try again.");
      return { ok: true };
    });
  }
  saveLabel({ kind, id = "", name, archived = false }) {
    const table = this.table(kind);
    if (typeof name !== "string" || !name.trim() || name.trim().length > 120)
      throw Error("Enter a name between 1 and 120 characters.");
    if (typeof archived !== "boolean") throw Error("Invalid archive state.");
    if (id && !this.db.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(id))
      throw Error("This entry no longer exists. Refresh and try again.");
    const now = new Date().toISOString();
    return this.transaction(() => {
      try {
        this.db
          .prepare(
            `INSERT INTO ${table}(id,name,archived,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,archived=excluded.archived,updated_at=excluded.updated_at`,
          )
          .run(id || randomUUID(), name.trim(), Number(archived), now, now);
      } catch (e) {
        if (e.message.includes("UNIQUE"))
          throw Error(
            "That name already exists. Rename or restore the saved entry.",
          );
        throw e;
      }
      return this.labels(kind);
    });
  }
  saveLink(input) {
    const { id = "", countryId, websiteId, url } = input;
    const siteId = input.siteId;
    if (
      siteId !== undefined &&
      siteId !== null &&
      (typeof siteId !== "string" || !siteId)
    )
      throw Error("Choose a website.");
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name || name.length > 200)
      throw Error("Enter a link name between 1 and 200 characters.");
    if (typeof url !== "string" || url.length > 20000)
      throw Error("Enter a valid affiliate URL.");
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw Error("Use a complete URL beginning with https:// or http://.");
    }
    if (
      !["https:", "http:"].includes(parsed.protocol) ||
      !parsed.hostname ||
      url.trim() !== url
    )
      throw Error("Use a complete HTTP(S) URL without surrounding spaces.");
    if (!countryId || !websiteId)
      throw Error("Choose a country and a promoting website/channel.");
    const placement = input.placement ?? "";
    const notes = input.notes ?? "";
    if (
      typeof placement !== "string" ||
      placement.length > 2000 ||
      typeof notes !== "string" ||
      notes.length > 20000
    )
      throw Error("Placement or notes are too long.");
    return this.transaction(() => {
      const existing = id
        ? this.db.prepare("SELECT * FROM managed_links WHERE id=?").get(id)
        : null;
      if (id && !existing)
        throw Error("This link no longer exists. Refresh and try again.");
      for (const [table, target, old, label] of [
        ["managed_countries", countryId, existing?.country_id, "country"],
        [
          "promoting_websites",
          websiteId,
          existing?.promoting_website_id,
          "website/channel",
        ],
      ]) {
        const entry = this.db
          .prepare(`SELECT archived FROM ${table} WHERE id=?`)
          .get(target);
        if (!entry) throw Error(`The selected ${label} no longer exists.`);
        if (entry.archived && target !== old)
          throw Error(
            `The selected ${label} is archived. Restore it before assigning new links.`,
          );
      }
      if (siteId) {
        const site = this.db
          .prepare("SELECT archived FROM placement_websites WHERE id=?")
          .get(siteId);
        if (!site) throw Error("The selected website no longer exists.");
        if (site.archived && siteId !== existing?.placement_website_id)
          throw Error(
            "The selected website is archived. Restore it before assigning new links.",
          );
      }
      const nextId = id || randomUUID();
      const now = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO managed_links(id,name,country_id,promoting_website_id,placement,affiliate_url,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,country_id=excluded.country_id,promoting_website_id=excluded.promoting_website_id,placement=excluded.placement,affiliate_url=excluded.affiliate_url,notes=excluded.notes,updated_at=excluded.updated_at`,
        )
        .run(
          nextId,
          name,
          countryId,
          websiteId,
          placement,
          url,
          notes,
          now,
          now,
        );
      if (siteId !== undefined)
        this.db
          .prepare("UPDATE managed_links SET placement_website_id=? WHERE id=?")
          .run(siteId, nextId);
      return this.db.prepare(`${linkSelect} WHERE l.id=?`).get(nextId);
    });
  }
  deleteLink(id) {
    if (typeof id !== "string" || !id) throw Error("Choose a link to delete.");
    const result = this.db
      .prepare("DELETE FROM managed_links WHERE id=?")
      .run(id);
    if (!result.changes)
      throw Error("This link was already deleted. Refresh the table.");
  }
  async backup(path) {
    await backup(this.db, path);
  }
}
