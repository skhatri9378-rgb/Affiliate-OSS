import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "./store.mjs";
import {
  checkUrl,
  LinkChecker,
  publicAddress,
  resolvePublic,
} from "./link-health.mjs";
for (const [status, outcome] of [
  [200, "working"],
  [204, "working"],
  [404, "broken"],
  [410, "broken"],
  [401, "review"],
  [403, "review"],
  [405, "review"],
  [429, "review"],
  [500, "review"],
])
  test(`HTTP ${status} is classified as ${outcome}`, async () => {
    assert.equal(
      (
        await checkUrl("https://example.invalid/?ref=A%2Fb&sub=a+b", {
          probe: async () => ({ status }),
        })
      ).outcome,
      outcome,
    );
  });
test("redirects are followed without changing the stored tracking URL", async () => {
  const original = "https://example.invalid/?ref=A%2Fb&sub=a+b";
  const seen = [];
  const out = await checkUrl(original, {
    probe: async (url) => {
      seen.push(url.href);
      return seen.length === 1
        ? { status: 302, location: "/next?keep=1" }
        : { status: 200 };
    },
  });
  assert.equal(out.outcome, "working");
  assert.equal(seen[0], original);
  assert.equal(seen[1], "https://example.invalid/next?keep=1");
});
test("redirect loops and excessive redirect chains need review", async () => {
  const loop = await checkUrl("https://example.invalid/", {
    probe: async () => ({ status: 302, location: "/" }),
  });
  assert.equal(loop.outcome, "review");
  let n = 0;
  const chain = await checkUrl("https://example.invalid/", {
    probe: async () => ({ status: 302, location: `/${++n}` }),
  });
  assert.equal(chain.outcome, "review");
  assert.equal(n, 6);
});
test("timeouts and DNS failures are inconclusive, never confirmed broken", async () => {
  const result = await checkUrl("https://example.invalid/", {
    probe: async () => {
      throw Error("DNS lookup failed");
    },
  });
  assert.equal(result.outcome, "review");
});
test("private, loopback, mapped and reserved addresses are blocked", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.1.2",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress("8.8.8.8"), true);
  assert.equal(publicAddress("2001:4860:4860::8888"), true);
});
test("all resolved addresses must be public before a connection can be made", async () => {
  await assert.rejects(
    resolvePublic(new URL("https://example.invalid"), async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]),
    /not checked/,
  );
  await assert.rejects(resolvePublic(new URL("file:///tmp/test")), /manual/);
  await assert.rejects(
    resolvePublic(new URL("https://user:password@example.invalid")),
    /manual/,
  );
});
function setup(t) {
  const store = new Store(":memory:");
  t.after(() => store.close());
  store.saveLabel({ kind: "countries", name: "India" });
  store.saveLabel({ kind: "websites", name: "Crypto channel" });
  const countryId = store.labels("countries")[0].id,
    websiteId = store.labels("websites")[0].id;
  const link = store.saveLink({
    name: "Link",
    countryId,
    websiteId,
    url: "https://example.invalid/?ref=A%2Fb&sub=a+b",
    placement: "",
    notes: "",
  });
  return { store, link, websiteId };
}
test("daily checks are opt-in and skip a recently checked URL until 24 hours pass", async (t) => {
  const { store, link } = setup(t);
  let date = new Date("2026-10-27T10:00:00Z");
  let calls = 0;
  const checker = new LinkChecker(store, {
    now: () => date,
    pause: async () => {},
    check: async () => {
      calls++;
      return { outcome: "working", httpStatus: 200, detail: "OK" };
    },
  });
  assert.equal(checker.enabled(), false);
  checker.setEnabled(true);
  assert.equal(checker.enabled(), true);
  await checker.run();
  await checker.run();
  assert.equal(calls, 1);
  date = new Date("2026-10-28T10:00:00Z");
  await checker.run();
  assert.equal(calls, 2);
  const saved = store.snapshot().links[0];
  assert.equal(saved.url, link.url);
  assert.equal(saved.healthStatus, "working");
  assert.equal(saved.healthCheckedAt, date.toISOString());
});
test("manual checks can recheck and honor the selected channel", async (t) => {
  const { store, websiteId } = setup(t);
  store.saveLabel({ kind: "websites", name: "Tech channel" });
  const techId = store
    .labels("websites")
    .find((w) => w.name === "Tech channel").id;
  store.saveLink({
    name: "Tech link",
    countryId: store.labels("countries")[0].id,
    websiteId: techId,
    url: "https://example.invalid/tech",
    placement: "",
    notes: "",
  });
  let calls = 0;
  const checker = new LinkChecker(store, {
    pause: async () => {},
    check: async () => {
      calls++;
      return { outcome: "broken", httpStatus: 404, detail: "Not found" };
    },
  });
  await checker.run({ websiteId, force: true });
  await checker.run({ websiteId, force: true });
  assert.equal(calls, 2);
  assert.equal(
    store.snapshot({ websiteId: techId }).links[0].healthStatus,
    null,
  );
  assert.equal(store.snapshot({ websiteId }).links[0].healthStatus, "broken");
});
test("a changed URL discards old health and stale in-flight results", async (t) => {
  const { store, link } = setup(t);
  const checker = new LinkChecker(store, {
    pause: async () => {},
    check: async () => {
      store.saveLink({ ...link, url: "https://example.invalid/new" });
      return { outcome: "broken", httpStatus: 404, detail: "Old URL" };
    },
  });
  await checker.run({ force: true });
  assert.equal(store.snapshot().links[0].healthStatus, null);
  assert.equal(
    store.db.prepare("SELECT count(*) AS n FROM link_health").get().n,
    0,
  );
});
test("archived channels are skipped by daily and manual checks", async (t) => {
  const { store, websiteId } = setup(t);
  store.saveLabel({
    kind: "websites",
    id: websiteId,
    name: "Crypto channel",
    archived: true,
  });
  let called = false;
  const checker = new LinkChecker(store, {
    check: async () => {
      called = true;
    },
  });
  await checker.run({ force: true });
  assert.equal(called, false);
});
test("deleting a checked link removes its health record", async (t) => {
  const { store, link } = setup(t);
  const checker = new LinkChecker(store, {
    check: async () => ({ outcome: "working", httpStatus: 200, detail: "OK" }),
  });
  await checker.run({ force: true });
  store.deleteLink(link.id);
  assert.equal(
    store.db.prepare("SELECT count(*) AS n FROM link_health").get().n,
    0,
  );
});
