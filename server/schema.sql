PRAGMA foreign_keys=ON;
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS manager_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS managed_countries (
 id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
 archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS manager_country_name ON managed_countries(trim(name) COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS promoting_websites (
 id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
 archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS manager_website_name ON promoting_websites(trim(name) COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS managed_links (
 id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
 country_id TEXT NOT NULL REFERENCES managed_countries(id) ON DELETE RESTRICT,
 promoting_website_id TEXT NOT NULL REFERENCES promoting_websites(id) ON DELETE RESTRICT,
 placement TEXT NOT NULL DEFAULT '', affiliate_url TEXT NOT NULL,
 notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS manager_link_country_website ON managed_links(country_id,promoting_website_id);
CREATE INDEX IF NOT EXISTS manager_link_website ON managed_links(promoting_website_id);
CREATE INDEX IF NOT EXISTS manager_link_updated ON managed_links(updated_at DESC,id);
INSERT OR IGNORE INTO manager_migrations VALUES(1,datetime('now'));

CREATE TABLE IF NOT EXISTS manager_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS link_health(link_id TEXT PRIMARY KEY REFERENCES managed_links(id) ON DELETE CASCADE,checked_url TEXT NOT NULL,checked_at TEXT NOT NULL,outcome TEXT NOT NULL CHECK(outcome IN ('working','review','broken')),http_status INTEGER,detail TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS manager_health_checked ON link_health(checked_at);
INSERT OR IGNORE INTO manager_migrations VALUES(2,datetime('now'));

CREATE TABLE IF NOT EXISTS placement_websites(id TEXT PRIMARY KEY,name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS placement_website_name ON placement_websites(trim(name) COLLATE NOCASE);
