import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import http from "node:http";
import https from "node:https";
const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
])
  blocked.addSubnet(address, prefix);
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
export function publicAddress(address) {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, "ipv4")
    : family === 6 &&
        globalV6.check(address, "ipv6") &&
        !address.toLowerCase().startsWith("2001:db8:");
}
export async function resolvePublic(url, resolve = lookup) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port))
  )
    throw Error("This URL needs a manual browser check.");
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await resolve(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw Error("Local, private and reserved addresses are not checked.");
  return addresses[0];
}
export async function probeHttp(url, { signal } = {}) {
  const address = await resolvePublic(url);
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).request(
      url,
      {
        method: "HEAD",
        signal,
        headers: {
          "User-Agent": "AffiliateLinksHealthCheck/1.0",
          Accept: "*/*",
        },
        lookup: (_host, options, cb) =>
          options.all
            ? cb(null, [address])
            : cb(null, address.address, address.family),
      },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode, location: res.headers.location });
      },
    );
    req.setTimeout(8000, () => req.destroy(Error("Request timed out.")));
    req.on("error", reject);
    req.end();
  });
}
export async function checkUrl(original, { probe = probeHttp, signal } = {}) {
  const deadline = AbortSignal.timeout(20000);
  const combined = signal ? AbortSignal.any([deadline, signal]) : deadline;
  try {
    let url = new URL(original);
    const seen = new Set();
    for (let step = 0; step <= 5; step++) {
      combined.throwIfAborted();
      if (seen.has(url.href))
        return {
          outcome: "review",
          httpStatus: null,
          detail: "Redirect loop. Open this link manually to verify it.",
        };
      seen.add(url.href);
      const result = await probe(url, { signal: combined });
      const code = result.status;
      if ([301, 302, 303, 307, 308].includes(code)) {
        if (!result.location)
          return {
            outcome: "review",
            httpStatus: code,
            detail: "Redirect has no destination. Manual review needed.",
          };
        if (step === 5)
          return {
            outcome: "review",
            httpStatus: code,
            detail: "Too many redirects. Manual review needed.",
          };
        url = new URL(result.location, url);
        continue;
      }
      if (code >= 200 && code < 300)
        return {
          outcome: "working",
          httpStatus: code,
          detail:
            "Destination responded successfully. This does not verify referral credit or offer availability.",
        };
      if ([404, 410].includes(code))
        return {
          outcome: "broken",
          httpStatus: code,
          detail:
            "Destination reports not found or removed. Review this link and replace it if needed.",
        };
      if ([401, 403, 405, 429].includes(code))
        return {
          outcome: "review",
          httpStatus: code,
          detail:
            "The site blocked the check, requires login, or does not support HEAD requests. It may still work in your browser.",
        };
      return {
        outcome: "review",
        httpStatus: code || null,
        detail:
          "Unexpected HTTP response. This may be temporary; check in your browser before replacing.",
      };
    }
  } catch (error) {
    return {
      outcome: "review",
      httpStatus: null,
      detail:
        error.name === "TimeoutError"
          ? "Check timed out. The link may still work in your browser."
          : String(error.message || "Network check failed.").slice(0, 250),
    };
  }
}
export class LinkChecker {
  constructor(
    store,
    {
      check = checkUrl,
      now = () => new Date(),
      pause = () => new Promise((r) => setTimeout(r, 250)),
    } = {},
  ) {
    this.store = store;
    this.check = check;
    this.now = now;
    this.pause = pause;
    this.running = false;
    this.stopping = false;
    this.processed = 0;
    this.total = 0;
    this.timer = null;
    this.controller = null;
  }
  enabled() {
    return (
      this.store.db
        .prepare("SELECT value FROM manager_settings WHERE key='daily_checks'")
        .get()?.value === "true"
    );
  }
  setEnabled(enabled) {
    if (typeof enabled !== "boolean")
      throw Error("Choose whether daily checks are enabled.");
    this.store.db
      .prepare(
        "INSERT INTO manager_settings VALUES('daily_checks',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(String(enabled));
    return this.status();
  }
  status() {
    return {
      enabled: this.enabled(),
      running: this.running,
      processed: this.processed,
      total: this.total,
      intervalHours: 24,
    };
  }
  async run({ websiteId = "", force = false } = {}) {
    if (this.running) return this.status();
    if (typeof websiteId !== "string")
      throw Error("Choose a valid channel/project.");
    const cutoff = new Date(
      this.now().getTime() - 24 * 60 * 60 * 1000,
    ).toISOString();
    const rows = this.store.db
      .prepare(
        `SELECT l.id,l.affiliate_url AS url FROM managed_links l JOIN managed_countries c ON c.id=l.country_id JOIN promoting_websites w ON w.id=l.promoting_website_id LEFT JOIN link_health h ON h.link_id=l.id AND h.checked_url=l.affiliate_url LEFT JOIN placement_websites s ON s.id=l.placement_website_id WHERE c.archived=0 AND w.archived=0 AND (s.archived IS NULL OR s.archived=0) AND (?='' OR w.id=?) AND (?=1 OR h.checked_at IS NULL OR h.checked_at<=?) ORDER BY h.checked_at,l.id`,
      )
      .all(websiteId, websiteId, Number(force), cutoff);
    this.running = true;
    this.processed = 0;
    this.total = rows.length;
    this.controller = new AbortController();
    try {
      for (const row of rows) {
        if (this.stopping) break;
        const result = await this.check(row.url, {
          signal: this.controller.signal,
        });
        if (this.stopping) break;
        this.store.db
          .prepare(
            `INSERT INTO link_health(link_id,checked_url,checked_at,outcome,http_status,detail) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM managed_links WHERE id=? AND affiliate_url=?) ON CONFLICT(link_id) DO UPDATE SET checked_url=excluded.checked_url,checked_at=excluded.checked_at,outcome=excluded.outcome,http_status=excluded.http_status,detail=excluded.detail`,
          )
          .run(
            row.id,
            row.url,
            this.now().toISOString(),
            result.outcome,
            result.httpStatus,
            result.detail,
            row.id,
            row.url,
          );
        this.processed++;
        if (this.processed < rows.length) await this.pause();
      }
    } finally {
      this.running = false;
      this.controller = null;
    }
    return this.status();
  }
  start(options) {
    if (!this.running)
      void this.run(options).catch(() => {
        this.running = false;
      });
    return this.status();
  }
  schedule() {
    this.stopping = false;
    const tick = () => {
      if (this.enabled() && !this.running) this.start({ force: false });
    };
    this.timer = setInterval(tick, 60000);
    this.timer.unref();
    this.initial = setTimeout(tick, 10000);
    this.initial.unref();
  }
  stop() {
    this.stopping = true;
    clearInterval(this.timer);
    clearTimeout(this.initial);
    this.controller?.abort();
  }
}
