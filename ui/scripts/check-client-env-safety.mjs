#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const srcRoot = path.join(projectRoot, "src");
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs"]);
const allowedServerAgnosticEnv = new Set(["NODE_ENV"]);

const staticImportPattern =
  /^\s*(?:import|export)\s+(?:type\s+)?(?:.+?\s+from\s+)?["']([^"']+)["']/gm;
const dynamicImportPattern = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const requirePattern = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
const dotEnvPattern = /process\.env\.([A-Z0-9_]+)/g;
const bracketEnvPattern = /process\.env\[['"]([A-Z0-9_]+)['"]\]/g;
const destructuredEnvPattern = /\{([^}]+)\}\s*=\s*process\.env\b/g;

if (!fs.existsSync(srcRoot)) {
  console.error(`Source directory not found: ${srcRoot}`);
  process.exit(1);
}

function walkSourceFiles(dir) {
  const result = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkSourceFiles(fullPath));
      continue;
    }
    if (sourceExtensions.has(path.extname(entry.name))) {
      result.push(path.normalize(fullPath));
    }
  }

  return result;
}

function stripLeadingTrivia(content) {
  let rest = content;
  for (;;) {
    const trimmed = rest.trimStart();
    if (trimmed.startsWith("//")) {
      const newline = trimmed.indexOf("\n");
      rest = newline === -1 ? "" : trimmed.slice(newline + 1);
      continue;
    }
    if (trimmed.startsWith("/*")) {
      const end = trimmed.indexOf("*/");
      rest = end === -1 ? "" : trimmed.slice(end + 2);
      continue;
    }
    return trimmed;
  }
}

function hasDirective(content, directive) {
  const stripped = stripLeadingTrivia(content);
  return (
    stripped.startsWith(`"${directive}"`) ||
    stripped.startsWith(`'${directive}'`)
  );
}

function collectImportSpecifiers(content) {
  const specs = new Set();
  for (const match of content.matchAll(staticImportPattern)) {
    specs.add(match[1]);
  }
  for (const match of content.matchAll(dynamicImportPattern)) {
    specs.add(match[1]);
  }
  for (const match of content.matchAll(requirePattern)) {
    specs.add(match[1]);
  }
  return specs;
}

function isInsideSrc(filePath) {
  const rel = path.relative(srcRoot, filePath);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function resolveImport(fromFile, spec) {
  let basePath = null;
  if (spec.startsWith("@/")) {
    basePath = path.join(srcRoot, spec.slice(2));
  } else if (spec.startsWith("./") || spec.startsWith("../")) {
    basePath = path.resolve(path.dirname(fromFile), spec);
  } else {
    return null;
  }

  const candidates = [];
  if (path.extname(basePath)) {
    candidates.push(basePath);
  } else {
    candidates.push(basePath);
    for (const ext of sourceExtensions) {
      candidates.push(`${basePath}${ext}`);
    }
    for (const ext of sourceExtensions) {
      candidates.push(path.join(basePath, `index${ext}`));
    }
  }

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const stat = fs.statSync(candidate);
    if (!stat.isFile()) continue;
    const resolved = path.normalize(candidate);
    if (!isInsideSrc(resolved)) continue;
    return resolved;
  }

  return null;
}

function isAllowedEnvName(name) {
  return name.startsWith("NEXT_PUBLIC_") || allowedServerAgnosticEnv.has(name);
}

function lineNumberForIndex(content, index) {
  return content.slice(0, index).split("\n").length;
}

function collectForbiddenEnvRefs(content) {
  const refs = [];

  for (const match of content.matchAll(dotEnvPattern)) {
    const envName = match[1];
    if (isAllowedEnvName(envName)) continue;
    refs.push({ envName, index: match.index ?? 0 });
  }

  for (const match of content.matchAll(bracketEnvPattern)) {
    const envName = match[1];
    if (isAllowedEnvName(envName)) continue;
    refs.push({ envName, index: match.index ?? 0 });
  }

  for (const match of content.matchAll(destructuredEnvPattern)) {
    const rawMembers = match[1]
      .split(",")
      .map((member) => member.trim())
      .filter(Boolean);

    for (const member of rawMembers) {
      const base = member.split(":")[0]?.split("=")[0]?.trim();
      if (!base || !/^[A-Z0-9_]+$/.test(base)) continue;
      if (isAllowedEnvName(base)) continue;
      refs.push({ envName: base, index: match.index ?? 0 });
    }
  }

  return refs;
}

const allSourceFiles = walkSourceFiles(srcRoot);
const fileMeta = new Map();

for (const file of allSourceFiles) {
  const content = fs.readFileSync(file, "utf8");
  fileMeta.set(file, {
    content,
    useClient: hasDirective(content, "use client"),
    useServer: hasDirective(content, "use server"),
    imports: collectImportSpecifiers(content),
  });
}

const clientEntries = allSourceFiles.filter((file) => fileMeta.get(file)?.useClient);
const queue = [...clientEntries];
const clientReachable = new Set();

while (queue.length > 0) {
  const current = queue.shift();
  if (!current || clientReachable.has(current)) continue;
  clientReachable.add(current);

  const meta = fileMeta.get(current);
  if (!meta || meta.useServer) continue;

  for (const spec of meta.imports) {
    const resolved = resolveImport(current, spec);
    if (!resolved) continue;
    if (fileMeta.get(resolved)?.useServer) continue;
    if (!clientReachable.has(resolved)) {
      queue.push(resolved);
    }
  }
}

const violations = [];

for (const file of clientReachable) {
  const meta = fileMeta.get(file);
  if (!meta || meta.useServer) continue;

  const forbiddenRefs = collectForbiddenEnvRefs(meta.content);
  for (const ref of forbiddenRefs) {
    violations.push({
      file: path.relative(projectRoot, file).replaceAll(path.sep, "/"),
      line: lineNumberForIndex(meta.content, ref.index),
      envName: ref.envName,
    });
  }
}

if (violations.length > 0) {
  console.error("Client environment safety check failed.");
  console.error("Found server-only env usage in client-reachable source files:");
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} uses process.env.${violation.envName}`);
  }
  process.exit(1);
}

console.log(
  `Client environment safety check passed (${clientEntries.length} client entry files scanned).`,
);
