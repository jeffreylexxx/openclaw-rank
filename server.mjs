import "dotenv/config";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === "production";
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3000);
const cacheDir = path.join(__dirname, ".cache", "openclaw-evidence");
const cacheTtlMs = Number(process.env.OPENCLAW_CACHE_TTL_MS || 15 * 60 * 1000);
const githubHeaders = {
  Accept: "application/vnd.github+json, application/json",
  "User-Agent": "openclaw-evidence-index",
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

const app = express();
await fs.mkdir(cacheDir, { recursive: true });

app.get("/api/github/releases", async (_request, response) => {
  const result = await fetchCachedJson(
    "github-releases.json",
    "https://api.github.com/repos/openclaw/openclaw/releases?per_page=100",
    { headers: githubHeaders },
  );

  if (result.ok) {
    response.setHeader("x-openclaw-cache", result.cacheState);
    response.json(result.data);
    return;
  }

  const atomResult = await fetchReleaseAtomFallback();
  if (atomResult.ok) {
    const npmFallback = await buildNpmReleaseFallback();
    const releases = mergeReleases(atomResult.data, npmFallback);
    response.setHeader("x-openclaw-cache", atomResult.cacheState);
    response.json(releases);
    return;
  }

  const npmFallback = await buildNpmReleaseFallback();
  if (npmFallback.length > 0) {
    response.setHeader("x-openclaw-cache", "npm-fallback");
    response.json(npmFallback);
    return;
  }

  response.status(503).json({
    error: "GitHub releases are unavailable and no local cache exists.",
    detail: result.error || atomResult.error,
  });
});

app.get("/api/github/issues", async (request, response) => {
  const page = String(request.query.page || "1");
  const url = new URL("https://api.github.com/repos/openclaw/openclaw/issues");
  for (const [key, value] of Object.entries(request.query)) {
    url.searchParams.set(key, String(value));
  }

  const result = await fetchCachedJson(`github-issues-page-${page}.json`, url.toString(), { headers: githubHeaders });
  response.setHeader("x-openclaw-cache", result.cacheState);
  response.status(result.ok ? 200 : 200).json(result.ok ? result.data : []);
});

app.get("/api/npm/openclaw", async (_request, response) => {
  const result = await fetchCachedJson("npm-openclaw.json", "https://registry.npmjs.org/openclaw");
  response.setHeader("x-openclaw-cache", result.cacheState);
  response.status(result.ok ? 200 : 503).json(result.ok ? result.data : { error: result.error });
});

if (isProduction) {
  app.use(express.static(path.join(__dirname, "dist")));
  app.get("*", (_request, response) => {
    response.sendFile(path.join(__dirname, "dist", "index.html"));
  });
} else {
  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      hmr: process.env.DISABLE_HMR !== "true",
      watch: {
        ignored: ["**/.cache/**", "**/dist/**"],
      },
    },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

async function buildNpmReleaseFallback() {
  const result = await fetchCachedJson("npm-openclaw.json", "https://registry.npmjs.org/openclaw");
  if (!result.ok || !result.data?.versions) return [];

  const versions = Object.keys(result.data.versions)
    .filter((version) => /^\d{4}\.\d+\.\d+(?:-\d+)?$/.test(version))
    .filter((version) => compareVersions(version, "2026.3.28") >= 0)
    .sort((a, b) => compareVersions(b, a));

  return versions.map((version) => {
    const meta = result.data.versions[version] || {};
    const published = result.data.time?.[version] || new Date().toISOString();
    const refs = [meta.gitHead, meta.dist?.shasum, meta.dist?.integrity].filter(Boolean).length;

    return {
      tag_name: `v${version}`,
      name: `openclaw ${version}`,
      html_url: `https://www.npmjs.com/package/openclaw/v/${version}`,
      prerelease: /(?:alpha|beta|rc)/i.test(version),
      published_at: published,
      created_at: published,
      body: [
        meta.description || "OpenClaw npm release metadata.",
        meta.gitHead ? `gitHead ${meta.gitHead}` : "",
        meta.dist?.shasum ? `npm shasum ${meta.dist.shasum}` : "",
        meta.dist?.integrity ? "npm integrity signature present" : "",
      ]
        .filter(Boolean)
        .join("\n"),
      reactions: { total_count: 0, "+1": 0, "-1": 0, hooray: 0, heart: 0, rocket: 0, confused: 0, eyes: 0 },
      mentions_count: refs,
    };
  });
}

function mergeReleases(primary, fallback) {
  const byVersion = new Map();
  for (const release of fallback) {
    byVersion.set(String(release.tag_name).replace(/^v/i, ""), release);
  }
  for (const release of primary) {
    byVersion.set(String(release.tag_name).replace(/^v/i, ""), release);
  }
  return Array.from(byVersion.values()).sort((a, b) =>
    compareVersions(String(b.tag_name).replace(/^v/i, ""), String(a.tag_name).replace(/^v/i, "")),
  );
}

function compareVersions(a, b) {
  const left = a.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] || 0) - (right[index] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

app.listen(port, host, () => {
  console.log(`OpenClaw Evidence Index running at http://${host}:${port}/`);
});

async function fetchCachedJson(cacheName, url, init = {}) {
  const cachePath = path.join(cacheDir, cacheName);
  const fresh = await readFreshCache(cachePath);
  if (fresh) {
    return { ok: true, data: fresh, cacheState: "cached" };
  }

  try {
    const upstream = await fetch(url, init);
    if (!upstream.ok) {
      const stale = await readCache(cachePath);
      if (stale) return { ok: true, data: stale, cacheState: "stale" };
      return { ok: false, error: `${upstream.status} ${upstream.statusText}`, cacheState: "miss" };
    }

    const data = await upstream.json();
    await writeCache(cachePath, data);
    return { ok: true, data, cacheState: "fresh" };
  } catch (error) {
    const stale = await readCache(cachePath);
    if (stale) return { ok: true, data: stale, cacheState: "stale" };
    return { ok: false, error: error instanceof Error ? error.message : String(error), cacheState: "miss" };
  }
}

async function fetchReleaseAtomFallback() {
  const cachePath = path.join(cacheDir, "github-releases-atom.json");
  const fresh = await readFreshCache(cachePath);
  if (fresh) {
    return { ok: true, data: fresh, cacheState: "cached-atom" };
  }

  try {
    const response = await fetch("https://github.com/openclaw/openclaw/releases.atom", {
      headers: { Accept: "application/atom+xml", "User-Agent": "openclaw-evidence-index" },
    });
    if (!response.ok) {
      const stale = await readCache(cachePath);
      if (stale) return { ok: true, data: stale, cacheState: "stale-atom" };
      return { ok: false, error: `${response.status} ${response.statusText}`, cacheState: "miss" };
    }

    const atom = await response.text();
    const releases = parseReleaseAtom(atom);
    await writeCache(cachePath, releases);
    return { ok: true, data: releases, cacheState: "fresh-atom" };
  } catch (error) {
    const stale = await readCache(cachePath);
    if (stale) return { ok: true, data: stale, cacheState: "stale-atom" };
    return { ok: false, error: error instanceof Error ? error.message : String(error), cacheState: "miss" };
  }
}

function parseReleaseAtom(atom) {
  return atom
    .split("<entry>")
    .slice(1)
    .map((entry) => {
      const title = decodeXml(extractTag(entry, "title"));
      const link = extractAttr(entry, "link", "href");
      const published = extractTag(entry, "published") || extractTag(entry, "updated");
      const content = decodeXml(extractTag(entry, "content")).replace(/<[^>]+>/g, " ");
      const version = (link.match(/\/tag\/v?([^"'>\s]+)/)?.[1] || title.match(/\d{4}\.\d+\.\d+(?:-\d+)?/)?.[0] || "").trim();
      const tag = version ? `v${version}` : title;

      return {
        tag_name: tag,
        name: title,
        html_url: link,
        prerelease: /(?:alpha|beta|rc)/i.test(version),
        published_at: published,
        created_at: published,
        body: content.replace(/\s+/g, " ").trim(),
        reactions: { total_count: 0, "+1": 0, "-1": 0, hooray: 0, heart: 0, rocket: 0, confused: 0, eyes: 0 },
        mentions_count: new Set(content.match(/#\d{2,}/g) || []).size,
      };
    })
    .filter((release) => release.tag_name && release.html_url);
}

function extractTag(text, tag) {
  return text.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] || "";
}

function extractAttr(text, tag, attr) {
  return text.match(new RegExp(`<${tag}[^>]*\\s${attr}="([^"]+)"`, "i"))?.[1] || "";
}

function decodeXml(value) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

async function readCache(cachePath) {
  try {
    return JSON.parse(await fs.readFile(cachePath, "utf8"));
  } catch {
    return null;
  }
}

async function readFreshCache(cachePath) {
  try {
    const stats = await fs.stat(cachePath);
    if (Date.now() - stats.mtimeMs > cacheTtlMs) return null;
    return JSON.parse(await fs.readFile(cachePath, "utf8"));
  } catch {
    return null;
  }
}

async function writeCache(cachePath, data) {
  const next = JSON.stringify(data);
  try {
    const current = await fs.readFile(cachePath, "utf8");
    if (current === next) return;
  } catch {
    // Cache file does not exist yet.
  }
  await fs.writeFile(cachePath, next, "utf8");
}
