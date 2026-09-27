import { existsSync, readFileSync } from "fs";
import path from "path";

type AppBuildManifest = {
  pages?: Record<string, string[]>;
};

type Finding = {
  file: string;
  rule: string;
  match: string;
};

const ROUTES_TO_SCAN = [
  "/layout",
  "/(manager)/layout",
  "/(manager)/managerCalendar/page",
  "/(manager)/managerLeaves/page",
  "/(manager)/managerSchedules/page",
];

const APP_CHUNK_PREFIX = "static/chunks/app/";

const SYNTAX_RULES: Array<{
  name: string;
  regex: RegExp;
}> = [
  {
    name: "BigInt literal",
    regex: /(?:^|[^\w$])(?:0|[1-9]\d*|0x[0-9a-f]+)n(?:[^\w$]|$)/i,
  },
  {
    name: "optional chaining",
    regex: /\?\.(?![0-9])/,
  },
  {
    name: "nullish coalescing",
    regex: /\?\?/,
  },
  {
    name: "Array.prototype.toSorted",
    regex: /\.toSorted\(/,
  },
  {
    name: "Array.prototype.toReversed",
    regex: /\.toReversed\(/,
  },
  {
    name: "Array.prototype.toSpliced",
    regex: /\.toSpliced\(/,
  },
  {
    name: "Promise.withResolvers",
    regex: /Promise\.withResolvers/,
  },
];

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function getRouteChunks(manifest: AppBuildManifest) {
  const pages = manifest.pages ?? {};
  const chunks = new Set<string>();
  const missingRoutes: string[] = [];

  function addChunks(routeChunks: string[]) {
    for (const chunk of routeChunks) {
      if (chunk.startsWith(APP_CHUNK_PREFIX) && chunk.endsWith(".js")) {
        chunks.add(chunk);
      }
    }
  }

  for (const route of ROUTES_TO_SCAN) {
    const routeChunks = pages[route];

    if (!routeChunks) {
      missingRoutes.push(route);
      continue;
    }

    addChunks(routeChunks);
  }

  if (missingRoutes.length > 0 && chunks.size === 0) {
    for (const routeChunks of Object.values(pages)) {
      addChunks(routeChunks);
    }
  }

  const routeChunks = [...chunks].sort();
  if (routeChunks.length === 0) {
    throw new Error("No app JavaScript chunks were found in .next/app-build-manifest.json.");
  }

  return routeChunks;
}

function findUnsupportedSyntax(chunks: string[]) {
  const findings: Finding[] = [];

  for (const chunk of chunks) {
    const filePath = path.join(process.cwd(), ".next", chunk);
    const source = readFileSync(filePath, "utf8");

    for (const rule of SYNTAX_RULES) {
      const match = source.match(rule.regex);

      if (match) {
        findings.push({
          file: chunk,
          rule: rule.name,
          match: match[0].slice(0, 120),
        });
      }
    }
  }

  return findings;
}

function verifyPolyfillSource() {
  const polyfillPath = path.join(process.cwd(), "src", "polyfills.ts");
  const source = readFileSync(polyfillPath, "utf8");
  const requiredGuards = [
    "ResizeObserver",
    "queueMicrotask",
    "CSS.escape",
  ];
  const missing = requiredGuards.filter((guard) => !source.includes(guard));

  if (missing.length > 0) {
    throw new Error(`Missing Firefox 66 polyfill guard(s): ${missing.join(", ")}`);
  }
}

function main() {
  const manifestPath = path.join(process.cwd(), ".next", "app-build-manifest.json");

  if (!existsSync(manifestPath)) {
    throw new Error("Build output was not found. Run npm run build first.");
  }

  verifyPolyfillSource();

  const manifest = readJson<AppBuildManifest>(manifestPath);
  const chunks = getRouteChunks(manifest);
  const findings = findUnsupportedSyntax(chunks);

  if (findings.length > 0) {
    const details = findings
      .map(
        (finding) =>
          `- ${finding.file}: ${finding.rule} (${JSON.stringify(finding.match)})`,
      )
      .join("\n");

    throw new Error(
      [
        "Firefox 66-incompatible syntax was found in manager initial chunks.",
        details,
        "Update transpilation/client boundaries before deploying Calendar or Schedules.",
      ].join("\n"),
    );
  }

  console.log(
    `Firefox 66 manager bundle check passed for ${chunks.length} initial chunks.`,
  );
}

main();
