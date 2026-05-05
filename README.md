# OpenClaw Evidence Index

OpenClaw Evidence Index is a React and Vite web app for comparing formal OpenClaw releases by public feedback evidence. It is designed to replace placeholder rankings with data that can be traced back to public network sources, including GitHub releases, GitHub issues, release reactions, and npm registry metadata.

The app focuses on OpenClaw versions published from 2026.3.28 onward. It excludes beta, alpha, and release-candidate builds so the table compares formal releases only.

## Ranking And Scoring

Each version receives an evidence score from public signals. The ranking is sorted by score, not by release date. Newer versions can rank below older versions when their public feedback contains more risk signals.

The score combines release-note evidence, GitHub issue or pull-request references from release notes, GitHub release reactions, GitHub issue volume, open and closed issue counts, issue comments, issue labels, and matched risk terms such as gateway, plugin, crash, hang, and security-related language. When two versions land in the same score bucket, the app applies a content-derived tie-breaker from the version's release notes, issue titles, keywords, and source labels so visible scores remain distinct.

The recommendation tier is based on the score:

- Strongly Recommended: 90 and above
- Recommended: 80 to 89.99
- Neutral: 70 to 79.99
- Not Recommended: 40 to 69.99
- Disaster: below 40

## Expanded Version Details

Clicking a version row opens its evidence panel. The Diagnostics section shows counted public signals for gateway reports, plugin reports, crash or hang reports, security terms, and open versus closed issues. These values are calculated from release text, GitHub issue or pull-request references in the release notes, and GitHub issue feedback attributed to the version's public feedback window.

The expanded panel also includes positive release signals, issue risk terms, release-note evidence, version-matched or feedback-window issues, and source references. The source links point back to GitHub releases, npm version pages, GitHub issue searches, and sampled issue pages so the ranking can be audited.

## Project Highlights

The main feature of this project is transparent release comparison. It avoids fabricated startup times, plugin health scores, or crash-rate percentages when no public source supports them. Instead, it uses real public text and issue metadata, presents the source links directly in the UI, and makes the scoring rule visible to users.

The interface is built for quick scanning: each row shows the version, rank, score, public GitHub issues or references, recommendation tier, and local community vote buttons. Users can expand any row when they want to inspect the evidence behind the score.

## Run Locally

Prerequisite: Node.js.

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

The development server runs a local API proxy at `/api/*`. The proxy caches successful GitHub and npm responses under `.cache/openclaw-evidence/`, which prevents ordinary page refreshes from quickly exhausting GitHub's anonymous API limit. If you have a GitHub personal access token, you can put `GITHUB_TOKEN=...` in `.env.local` to raise the API limit. The token stays on the local Node server and is not exposed to the browser bundle.

Build for production:

```bash
npm run build
```

Preview the production build with the same proxy and cache:

```bash
npm run preview
```

## Deploy To GitHub Pages

GitHub Pages cannot run the local `server.mjs` proxy because Pages is static hosting. For that reason, the deployed site uses browser-side network fallback: it first tries the local `/api/*` paths when running locally, then falls back to GitHub and npm public APIs when hosted on GitHub Pages.

The repository includes `.github/workflows/pages.yml`. Push the project to GitHub, then open the repository settings and set Pages to deploy from GitHub Actions. The workflow installs dependencies, builds the Vite app, and publishes the `dist` folder.

Do not publish the raw source folder directly as the Pages site. The source `index.html` points at `/src/main.tsx`, which browsers cannot run without Vite's build step.
