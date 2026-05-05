import { EvidenceSource, VersionInfo } from "../types";

const OWNER = "openclaw";
const REPO = "openclaw";
const SINCE_VERSION = "2026.3.28";
const SINCE_DATE = "2026-03-28T00:00:00Z";
const RELEASES_ENDPOINT = "/api/github/releases";
const NPM_ENDPOINT = "/api/npm/openclaw";
const ISSUES_ENDPOINT = "/api/github/issues";
const DIRECT_RELEASES_ENDPOINT = `https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=100`;
const DIRECT_NPM_ENDPOINT = "https://registry.npmjs.org/openclaw";
const DIRECT_ISSUES_ENDPOINT = `https://api.github.com/repos/${OWNER}/${REPO}/issues`;

interface GitHubRelease {
  tag_name: string;
  name: string | null;
  html_url: string;
  prerelease: boolean;
  published_at: string | null;
  created_at: string;
  body: string | null;
  reactions?: {
    total_count: number;
    "+1": number;
    "-1": number;
    hooray: number;
    heart: number;
    rocket: number;
    confused: number;
    eyes: number;
  };
  mentions_count?: number;
}

interface NpmRegistry {
  time?: Record<string, string>;
  "dist-tags"?: Record<string, string>;
}

interface GitHubIssue {
  html_url: string;
  title: string;
  state: "open" | "closed";
  labels?: Array<{ name: string }>;
  comments: number;
  created_at: string;
  updated_at: string;
  body?: string | null;
  pull_request?: unknown;
}

export async function fetchAndAnalyzeVersions(currentVersions: VersionInfo[]): Promise<VersionInfo[]> {
  const npmRegistry = await fetchNpmRegistry();
  const releases = await fetchReleases(npmRegistry);
  const publicIssues = await fetchPublicIssues();
  const formalReleases = releases
    .filter((release) => isFormalRelease(release))
    .filter((release) => compareVersions(extractVersion(release.tag_name), SINCE_VERSION) >= 0)
    .sort((a, b) => compareVersions(extractVersion(b.tag_name), extractVersion(a.tag_name)))
    .slice(0, 30);

  const latestVersion = npmRegistry["dist-tags"]?.latest ?? extractVersion(formalReleases[0]?.tag_name ?? "");
  const releasesAscending = [...formalReleases].sort((a, b) => releaseTime(a) - releaseTime(b));

  const analyzed: VersionInfo[] = [];
  for (const release of formalReleases) {
    const version = extractVersion(release.tag_name);
    const nextRelease = releasesAscending.find((candidate) => releaseTime(candidate) > releaseTime(release));
    const issues = attributeIssuesToRelease(version, release, nextRelease, publicIssues);
    analyzed.push(buildVersionInfo(release, npmRegistry, issues, latestVersion, currentVersions, nextRelease));
  }

  return makeScoresDistinct(analyzed)
    .sort(compareByScoreAndEvidence)
    .map((version, index) => {
      const previous = currentVersions.find((item) => item.version === version.version);
      let rankTrend: VersionInfo["rankTrend"] = "new";
      if (previous?.rank) {
        if (index + 1 < previous.rank) rankTrend = "up";
        else if (index + 1 > previous.rank) rankTrend = "down";
        else rankTrend = "stable";
      }

      return {
        ...version,
        rank: index + 1,
        rankTrend,
        voteRecommend: previous?.voteRecommend || 0,
        voteNotRecommend: previous?.voteNotRecommend || 0,
      };
    });
}

async function fetchReleases(npmRegistry: NpmRegistry): Promise<GitHubRelease[]> {
  const releases = await fetchJson<GitHubRelease[] | null>(RELEASES_ENDPOINT, null, [DIRECT_RELEASES_ENDPOINT]);
  if (releases?.length) return releases;

  const npmFallback = buildNpmReleaseFallback(npmRegistry);
  if (npmFallback.length) return npmFallback;

  throw new Error("Release data could not be loaded from the local proxy, GitHub API, or npm registry.");
}

async function fetchNpmRegistry(): Promise<NpmRegistry> {
  return fetchJson<NpmRegistry>(NPM_ENDPOINT, {}, [DIRECT_NPM_ENDPOINT]);
}

async function fetchPublicIssues(): Promise<GitHubIssue[]> {
  const issues: GitHubIssue[] = [];
  const sinceTime = new Date(SINCE_DATE).getTime();

  for (let page = 1; page <= 6; page += 1) {
    const query = `state=all&sort=created&direction=desc&per_page=100&page=${page}`;
    const url = `${ISSUES_ENDPOINT}?${query}`;
    const directUrl = `${DIRECT_ISSUES_ENDPOINT}?${query}`;
    const pageItems = await fetchJson<GitHubIssue[]>(url, [], [directUrl]);
    if (pageItems.length === 0) break;

    const issueItems = pageItems.filter((issue) => !issue.pull_request);
    issues.push(...issueItems.filter((issue) => new Date(issue.created_at).getTime() >= sinceTime));

    const reachedOlderIssues = pageItems.some((issue) => new Date(issue.created_at).getTime() < sinceTime);
    if (reachedOlderIssues) break;
  }

  return issues;
}

async function fetchJson<T>(url: string, fallback: T, alternates: string[] = []): Promise<T> {
  for (const candidate of [url, ...alternates]) {
    const result = await tryFetchJson<T>(candidate);
    if (result.ok) return result.data;
  }
  return fallback;
}

async function tryFetchJson<T>(url: string): Promise<{ ok: true; data: T } | { ok: false }> {
  try {
    const response = await fetch(resolveFetchUrl(url), {
      headers: {
        Accept: "application/vnd.github+json, application/json",
      },
    });
    if (!response.ok) return { ok: false };
    return { ok: true, data: (await response.json()) as T };
  } catch (error) {
    console.warn(`Unable to fetch ${url}`, error);
    return { ok: false };
  }
}

function buildNpmReleaseFallback(npmRegistry: NpmRegistry): GitHubRelease[] {
  const versions = Object.keys(npmRegistry.time || {})
    .filter((version) => /^\d{4}\.\d+\.\d+(?:-\d+)?$/.test(version))
    .filter((version) => compareVersions(version, SINCE_VERSION) >= 0)
    .sort((a, b) => compareVersions(b, a));

  return versions.map((version) => ({
    tag_name: `v${version}`,
    name: `openclaw ${version}`,
    html_url: `https://www.npmjs.com/package/openclaw/v/${version}`,
    prerelease: /(?:alpha|beta|rc)/i.test(version),
    published_at: npmRegistry.time?.[version] || null,
    created_at: npmRegistry.time?.[version] || new Date().toISOString(),
    body: "OpenClaw npm release metadata. GitHub release details unavailable in static mode.",
    reactions: { total_count: 0, "+1": 0, "-1": 0, hooray: 0, heart: 0, rocket: 0, confused: 0, eyes: 0 },
    mentions_count: 1,
  }));
}

function resolveFetchUrl(url: string) {
  if (!url.startsWith("/")) return url;
  if (typeof window !== "undefined") return url;
  return `http://127.0.0.1:3000${url}`;
}

function buildVersionInfo(
  release: GitHubRelease,
  npmRegistry: NpmRegistry,
  issues: GitHubIssue[],
  latestVersion: string,
  currentVersions: VersionInfo[],
  nextRelease?: GitHubRelease,
): VersionInfo {
  const version = extractVersion(release.tag_name);
  const textBlocks = [release.body || "", ...issues.map((issue) => `${issue.title}\n${issue.body || ""}`)];
  const combinedText = textBlocks.join("\n").toLowerCase();
  const releaseText = (release.body || "").toLowerCase();

  const closedIssueCount = issues.filter((issue) => issue.state === "closed").length;
  const openIssueCount = issues.filter((issue) => issue.state === "open").length;
  const negativeSignalCount = countIssueSignals(issues, negativeTerms);
  const positiveReactionCount = positiveReactions(release);
  const negativeReactionCount = negativeReactions(release);
  const positiveSignalCount = countTerms(releaseText, positiveTerms) + closedIssueCount + positiveReactionCount;
  const securityReports = countTerms(combinedText, securityTerms);
  const crashOrHangReports = countTerms(combinedText, crashTerms);
  const gatewayReports = countTerms(combinedText, gatewayTerms);
  const pluginReports = countTerms(combinedText, pluginTerms);
  const releaseBullets = extractReleaseBullets(release.body || "", ["changes", "highlights", "fixes"]);
  const releaseReferenceCount = Math.max(extractGitHubReferences(release.body || "").length, release.mentions_count || 0);
  const totalIssueComments = issues.reduce((total, issue) => total + issue.comments, 0);
  const issueLabelCount = issues.reduce((total, issue) => total + (issue.labels?.length || 0), 0);
  const releaseWordCount = countWords(release.body || "");
  const releaseBulletCount = releaseBullets.length;

  const issueCount = issues.length + releaseReferenceCount;
  const sampleCount = issueCount + (release.reactions?.total_count || 0) + 1;
  const confidence = sampleCount >= 20 ? "high" : sampleCount >= 6 ? "medium" : "low";
  const score = calculateEvidenceScore({
    sampleCount,
    issueCount,
    openIssueCount,
    closedIssueCount,
    positiveSignalCount,
    negativeSignalCount,
    securityReports,
    crashOrHangReports,
    gatewayReports,
    pluginReports,
    positiveReactionCount,
    negativeReactionCount,
    releaseWordCount,
    releaseBulletCount,
    releaseReferenceCount,
    totalIssueComments,
    issueLabelCount,
  });

  const previous = currentVersions.find((item) => item.version === version);
  const sources = buildSources(version, release, npmRegistry, issues, nextRelease);

  return {
    version,
    releaseDate: formatDate(npmRegistry.time?.[version] || release.published_at || release.created_at),
    publishedAt: npmRegistry.time?.[version] || release.published_at || release.created_at,
    isLatest: version === latestVersion,
    score,
    rank: previous?.rank || 0,
    rankTrend: "new",
    recommendationIndex: score,
    diagnostics: {
      gatewayReports,
      pluginReports,
      crashOrHangReports,
      securityReports,
    },
    errorKeywords: topMatchedTerms(combinedText, [...crashTerms, ...securityTerms, ...negativeTerms], 8),
    positiveKeywords: topMatchedTerms(releaseText, positiveTerms, 8),
    upgradePros: releaseBullets.slice(0, 5),
    upgradeCons: issues.slice(0, 5).map((issue) => issue.title),
    voteRecommend: previous?.voteRecommend || 0,
    voteNotRecommend: previous?.voteNotRecommend || 0,
    sampleCount,
    issueCount,
    openIssueCount,
    closedIssueCount,
    positiveSignalCount,
    negativeSignalCount,
    confidence,
    scoringBasis: `Score = public release reactions, release-note GitHub references, issue state, comments, labels, and risk terms. Issue evidence includes GitHub references in release notes plus issues attributed by explicit version mentions or the public feedback window until the next formal release. Ranking ignores publish date; equal evidence buckets are separated by content-derived tie-breakers.`,
    sources,
  };
}

function calculateEvidenceScore(input: {
  sampleCount: number;
  issueCount: number;
  openIssueCount: number;
  closedIssueCount: number;
  positiveSignalCount: number;
  negativeSignalCount: number;
  securityReports: number;
  crashOrHangReports: number;
  gatewayReports: number;
  pluginReports: number;
  positiveReactionCount: number;
  negativeReactionCount: number;
  releaseWordCount: number;
  releaseBulletCount: number;
  releaseReferenceCount: number;
  totalIssueComments: number;
  issueLabelCount: number;
}) {
  const releaseEvidence =
    Math.log1p(input.releaseWordCount) * 1.15 +
    Math.log1p(input.releaseBulletCount) * 4.2 +
    Math.log1p(input.releaseReferenceCount) * 5.3 +
    Math.log1p(input.positiveSignalCount) * 4.6 +
    Math.log1p(input.positiveReactionCount) * 3.1;
  const issueResolutionEvidence =
    Math.log1p(input.closedIssueCount) * 4.35 +
    Math.log1p(input.totalIssueComments) * 0.82 +
    Math.log1p(input.issueLabelCount) * 1.5;
  const publicAttention = Math.log1p(input.sampleCount) * 1.1;
  const risk =
    Math.log1p(input.openIssueCount) * 6.4 +
    Math.log1p(input.negativeSignalCount) * 4.7 +
    Math.log1p(input.securityReports) * 4.25 +
    Math.log1p(input.crashOrHangReports) * 5.15 +
    Math.log1p(input.gatewayReports) * 1.85 +
    Math.log1p(input.pluginReports) * 1.65 +
    input.negativeReactionCount * 1.4;
  const sparseEvidencePenalty = input.sampleCount < 3 ? 8.5 : input.sampleCount < 8 ? 3.75 : 0;

  return clamp(42 + releaseEvidence + issueResolutionEvidence + publicAttention - risk - sparseEvidencePenalty, 0, 100);
}

function compareByScoreAndEvidence(a: VersionInfo, b: VersionInfo) {
  if (b.score !== a.score) return b.score - a.score;
  return evidenceTieBreaker(b) - evidenceTieBreaker(a);
}

function makeScoresDistinct(versions: VersionInfo[]) {
  const ordered = [...versions].sort(compareByScoreAndEvidence);
  const usedScores = new Set<string>();

  return ordered.map((version) => {
    let score = roundToTwo(version.score);
    while (usedScores.has(score.toFixed(2)) && score > 0) {
      score = roundToTwo(score - 0.01);
    }
    usedScores.add(score.toFixed(2));
    return {
      ...version,
      score,
      recommendationIndex: score,
    };
  });
}

function buildSources(
  version: string,
  release: GitHubRelease,
  npmRegistry: NpmRegistry,
  issues: GitHubIssue[],
  nextRelease?: GitHubRelease,
): EvidenceSource[] {
  const releaseDate = formatDate(npmRegistry.time?.[version] || release.published_at || release.created_at);
  const nextDate = nextRelease ? formatDate(npmRegistry.time?.[extractVersion(nextRelease.tag_name)] || nextRelease.published_at || nextRelease.created_at) : undefined;
  const issueWindowQuery = nextDate
    ? `is:issue created:${releaseDate}..${nextDate}`
    : `is:issue created:>=${releaseDate}`;
  const sources: EvidenceSource[] = [
    { label: `GitHub release ${release.tag_name}`, url: release.html_url, type: "release" },
    { label: `npm package ${version}`, url: `https://www.npmjs.com/package/openclaw/v/${version}`, type: "npm" },
    {
      label: `GitHub feedback window for ${version}`,
      url: `https://github.com/${OWNER}/${REPO}/issues?q=${encodeURIComponent(issueWindowQuery)}`,
      type: "search",
    },
  ];

  if (npmRegistry.time?.[version]) {
    sources.push({ label: `npm registry timestamp ${version}`, url: NPM_ENDPOINT, type: "npm" });
  }

  issues.slice(0, 5).forEach((issue) => {
    sources.push({ label: issue.title, url: issue.html_url, type: "issue" });
  });

  return sources;
}

function isFormalRelease(release: GitHubRelease) {
  const version = extractVersion(release.tag_name);
  return Boolean(version) && !release.prerelease && !/(alpha|beta|rc)/i.test(version);
}

function extractVersion(tagName: string) {
  return tagName.replace(/^v/i, "");
}

function releaseTime(release: GitHubRelease) {
  return new Date(release.published_at || release.created_at).getTime();
}

function attributeIssuesToRelease(
  version: string,
  release: GitHubRelease,
  nextRelease: GitHubRelease | undefined,
  publicIssues: GitHubIssue[],
) {
  const start = releaseTime(release);
  const end = nextRelease ? releaseTime(nextRelease) : Date.now();
  const versionPattern = new RegExp(`\\b${escapeRegExp(version)}\\b`, "i");

  return publicIssues.filter((issue) => {
    const text = `${issue.title}\n${issue.body || ""}`;
    if (versionPattern.test(text)) return true;

    const created = new Date(issue.created_at).getTime();
    return created >= start && created < end;
  });
}

function compareVersions(a: string, b: string) {
  const left = a.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] || 0) - (right[index] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toISOString().slice(0, 10);
}

function positiveReactions(release: GitHubRelease) {
  const reactions = release.reactions;
  if (!reactions) return 0;
  return (reactions["+1"] || 0) + (reactions.hooray || 0) + (reactions.heart || 0) + (reactions.rocket || 0);
}

function negativeReactions(release: GitHubRelease) {
  const reactions = release.reactions;
  if (!reactions) return 0;
  return (reactions["-1"] || 0) + (reactions.confused || 0);
}

function countIssueSignals(issues: GitHubIssue[], terms: string[]) {
  return issues.reduce((total, issue) => {
    const labels = (issue.labels || []).map((label) => label.name).join(" ");
    const text = `${issue.title} ${labels} ${issue.body || ""}`.toLowerCase();
    return total + countTerms(text, terms);
  }, 0);
}

function countTerms(text: string, terms: string[]) {
  return terms.reduce((total, term) => {
    const pattern = new RegExp(escapeRegExp(term), "gi");
    return total + (text.match(pattern)?.length || 0);
  }, 0);
}

function topMatchedTerms(text: string, terms: string[], limit: number) {
  return terms
    .map((term) => ({ term, count: countTerms(text, [term]) }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((entry) => entry.term);
}

function extractReleaseBullets(body: string, headings: string[]) {
  const lines = body.split("\n");
  const bullets: string[] = [];
  let active = false;

  for (const line of lines) {
    const normalized = line.trim().toLowerCase();
    if (normalized.startsWith("###")) {
      active = headings.some((heading) => normalized.includes(heading));
      continue;
    }

    if (active && /^[-*]\s+/.test(line.trim())) {
      bullets.push(line.trim().replace(/^[-*]\s+/, "").replace(/\s+/g, " "));
    }
  }

  return bullets;
}

function extractGitHubReferences(body: string) {
  return Array.from(new Set((body.match(/#\d{2,}/g) || []).map((reference) => reference.slice(1))));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, roundToTwo(value)));
}

function roundToTwo(value: number) {
  return Number(value.toFixed(2));
}

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function evidenceTieBreaker(version: VersionInfo) {
  const textEvidence = [
    version.version,
    ...version.positiveKeywords,
    ...version.errorKeywords,
    ...version.upgradePros,
    ...version.upgradeCons,
    ...version.sources.map((source) => source.label),
  ].join("\n");

  return (
    version.sampleCount * 2.17 +
    version.closedIssueCount * 5.31 -
    version.openIssueCount * 7.19 +
    version.positiveSignalCount * 1.73 -
    version.negativeSignalCount * 2.11 -
    version.diagnostics.crashOrHangReports * 4.07 -
    version.diagnostics.securityReports * 3.41 +
    version.sources.length * 0.91 +
    contentHash(textEvidence) / 100000
  );
}

function contentHash(text: string) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) % 100000;
  }
  return hash;
}

const positiveTerms = [
  "fix",
  "fixes",
  "resolved",
  "restore",
  "restores",
  "performance",
  "faster",
  "reduce",
  "harden",
  "improve",
  "improved",
  "support",
  "stable",
  "works",
  "recommended",
];

const negativeTerms = [
  "bug",
  "regression",
  "broken",
  "breaks",
  "fail",
  "fails",
  "failure",
  "error",
  "unresponsive",
  "slow",
  "timeout",
  "loop",
  "auth",
  "unsupported",
];

const crashTerms = [
  "crash",
  "crashes",
  "crash-loop",
  "hang",
  "hangs",
  "oom",
  "out of memory",
  "stack overflow",
  "maximum call stack",
  "dead",
];

const securityTerms = [
  "security",
  "vulnerability",
  "ssrf",
  "authorization",
  "bypass",
  "token",
  "secret",
  "unsafe",
  "injection",
  "credential",
];

const gatewayTerms = [
  "gateway",
  "gateway start",
  "startup",
  "service",
  "systemd",
  "restart",
  "port",
  "listener",
];

const pluginTerms = [
  "plugin",
  "plugins",
  "plugin loader",
  "runtime-deps",
  "bundled plugin",
  "provider",
  "mcp",
];
