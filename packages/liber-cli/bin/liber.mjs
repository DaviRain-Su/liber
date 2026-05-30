#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
  clearCliConfig,
  createIngestPayload,
  dryRunPublishPlan,
  extractEpubChapters,
  inspectEpub,
  loadCliConfig,
  LiberCliError,
  MANIFEST_SCHEMA,
  publicConfigStatus,
  publishBookManifestChunked,
  saveCliConfig,
  signInWithSuiPrivateKey,
  startBrowserAuth,
  verifyPublishLicense,
  waitForBrowserAuth,
  writeBookManifest,
} from "../src/liber-core.mjs";

function usage() {
  return `Liber CLI

Usage:
  liber license explain
  liber auth browser [--api-url <url>] [--no-open] [--timeout <seconds>]
  liber auth key [--api-url <url>] [--key-file <path>|--private-key <key>] [--scheme ed25519|secp256k1|secp256r1]
  liber auth login --api-url <url> [--admin-token <token>] [--wallet <address>]
  liber auth status
  liber auth logout
  liber book inspect <file.epub> [--json]
  liber book verify-license <file.epub> --source <url> [--license CC0-1.0|PUBLIC-DOMAIN] [--evidence <text>] [--json]
  liber book extract <file.epub> [--json]
  liber book package <file.epub> --source <url> --license CC0-1.0|PUBLIC-DOMAIN --out <manifest.json> [--evidence <text>]
  liber book publish <manifest.json> [--dry-run] [--api-url <url>] [--admin-token <token>] [--json]
`;
}

function parseFlags(args) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      pos.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (key === "json" || key === "dry-run" || key === "no-open") {
      flags[key] = true;
    } else {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) throw new LiberCliError("ARG_REQUIRED", `Missing value for --${key}.`);
      flags[key] = value;
      i += 1;
    }
  }
  return { flags, pos };
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function openBrowser(url) {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function printLicensePolicy() {
  process.stdout.write(`Liber publish policy

Accepted:
  - CC0-1.0
  - PUBLIC-DOMAIN

Rejected:
  - CC BY
  - CC BY-SA
  - CC BY-NC
  - Unknown licenses
  - All rights reserved

Public domain is allowed, but it is not the same thing as CC0. CC BY and
CC BY-NC are rejected because they add downstream attribution, share-alike,
or non-commercial constraints that do not fit Liber's open library policy.
`);
}

function printInspect(info) {
  process.stdout.write(`EPUB: ${info.path}
Title: ${info.metadata.title || "(missing)"}
Creator: ${info.metadata.creator || "(missing)"}
Language: ${info.metadata.language || "(missing)"}
Identifier: ${info.metadata.identifier || "(missing)"}
Rights: ${info.metadata.rights.join("; ") || "(missing)"}
SHA-256: ${info.sha256}
OPF: ${info.opfPath}
Manifest items: ${info.manifest.length}
Spine items: ${info.spine.length}
`);
}

function printVerification(result) {
  process.stdout.write(`${result.accepted ? "ACCEPTED" : "REJECTED"}: ${result.reason}\n`);
  if (result.license) process.stdout.write(`License: ${result.license}\n`);
}

function printAuthStatus(status) {
  process.stdout.write(`Liber CLI auth
API URL: ${status.apiUrl || "(not set)"}
Wallet: ${status.wallet || "(not set)"}
Admin token: ${status.adminTokenConfigured ? "configured" : "not configured"}
Config: ${status.configPath}
`);
}

function printChapters(chapters) {
  process.stdout.write(`Extracted ${chapters.length} chapter(s)\n`);
  for (const chapter of chapters) {
    process.stdout.write(`${chapter.n}. ${chapter.title} (${chapter.text.length} chars)\n`);
  }
}

function printPlan(plan) {
  process.stdout.write(`Dry-run publish plan

Storage:
  EPUB: ${plan.storage.path}
  SHA-256: ${plan.storage.sha256}
  Size: ${plan.storage.size}

API:
  POST ${plan.api.ingestUrl}
  Payload license: ${plan.api.ingestPayload.license}
  Chapters: ${plan.api.ingestPayload.chapters?.length ?? "from EPUB"}

Registry:
  contentId: ${plan.registry.contentId}
  kind: ${plan.registry.kind}
  license: ${plan.registry.license}
`);
}

async function main(argv) {
  const [domain, action, ...rest] = argv;
  if (!domain || domain === "--help" || domain === "-h") {
    process.stdout.write(usage());
    return 0;
  }

  if (domain === "license" && action === "explain") {
    printLicensePolicy();
    return 0;
  }

  if (domain === "auth") {
    const { flags } = parseFlags(rest);
    if (action === "browser") {
      const cfg = await loadCliConfig({ configPath: flags.config });
      const started = await startBrowserAuth({ apiUrl: flags["api-url"], config: cfg, configPath: flags.config });
      if (!flags.json) {
        process.stdout.write(`Open this URL to authorize Liber CLI:\n${started.authorizeUrl}\n\n`);
        if (!flags["no-open"]) openBrowser(started.authorizeUrl);
        process.stdout.write("Waiting for wallet approval...\n");
      }
      const approved = await waitForBrowserAuth(started, { timeoutMs: Number(flags.timeout || 120) * 1000 });
      const saved = await saveCliConfig({
        apiUrl: started.apiUrl,
        adminToken: approved.token,
        wallet: approved.user?.wallet || approved.wallet,
      }, { configPath: flags.config });
      const status = publicConfigStatus(saved, { configPath: flags.config });
      flags.json ? printJson(status) : process.stdout.write(`Saved Liber CLI browser authorization for ${status.wallet || status.apiUrl}\n`);
      return 0;
    }
    if (action === "key") {
      const approved = await signInWithSuiPrivateKey({
        apiUrl: flags["api-url"],
        keyFile: flags["key-file"],
        privateKey: flags["private-key"],
        scheme: flags.scheme,
        configPath: flags.config,
      });
      const saved = await saveCliConfig({
        apiUrl: approved.apiUrl,
        adminToken: approved.token,
        wallet: approved.wallet,
      }, { configPath: flags.config });
      const status = publicConfigStatus(saved, { configPath: flags.config });
      flags.json ? printJson(status) : process.stdout.write(`Saved Liber CLI key authorization for ${status.wallet || status.apiUrl}\n`);
      return 0;
    }
    if (action === "login") {
      if (!flags["api-url"]) throw new LiberCliError("ARG_REQUIRED", "Missing --api-url.");
      const adminToken = flags["admin-token"] || process.env.LIBER_ADMIN_TOKEN || process.env.ADMIN_TOKEN || "";
      const saved = await saveCliConfig({ apiUrl: flags["api-url"], adminToken, wallet: flags.wallet }, { configPath: flags.config });
      const status = publicConfigStatus(saved, { configPath: flags.config });
      flags.json ? printJson(status) : process.stdout.write(`Saved Liber CLI auth config for ${status.apiUrl}\n`);
      return 0;
    }
    if (action === "status") {
      const cfg = await loadCliConfig({ configPath: flags.config });
      const status = publicConfigStatus(cfg, { configPath: flags.config });
      flags.json ? printJson(status) : printAuthStatus(status);
      return 0;
    }
    if (action === "logout") {
      await clearCliConfig({ configPath: flags.config });
      process.stdout.write("Removed Liber CLI auth config.\n");
      return 0;
    }
  }

  if (domain !== "book") throw new LiberCliError("UNKNOWN_COMMAND", `Unknown command: ${domain}.`);
  const { flags, pos } = parseFlags(rest);

  if (action === "inspect") {
    const file = pos[0];
    if (!file) throw new LiberCliError("ARG_REQUIRED", "Missing EPUB path.");
    const info = await inspectEpub(file);
    flags.json ? printJson(info) : printInspect(info);
    return 0;
  }

  if (action === "verify-license") {
    const file = pos[0];
    if (!file) throw new LiberCliError("ARG_REQUIRED", "Missing EPUB path.");
    const info = await inspectEpub(file);
    const result = verifyPublishLicense(info, { source: flags.source, license: flags.license, evidence: flags.evidence });
    flags.json ? printJson(result) : printVerification(result);
    return result.accepted ? 0 : 2;
  }

  if (action === "extract") {
    const file = pos[0];
    if (!file) throw new LiberCliError("ARG_REQUIRED", "Missing EPUB path.");
    const chapters = await extractEpubChapters(file);
    flags.json ? printJson({ chapters }) : printChapters(chapters);
    return 0;
  }

  if (action === "package") {
    const file = pos[0];
    if (!file) throw new LiberCliError("ARG_REQUIRED", "Missing EPUB path.");
    const manifest = await writeBookManifest(file, {
      source: flags.source,
      license: flags.license,
      evidence: flags.evidence,
      out: flags.out,
    });
    process.stdout.write(`Wrote ${flags.out} (${MANIFEST_SCHEMA}, ${manifest.source.license})\n`);
    return 0;
  }

  if (action === "publish") {
    const file = pos[0];
    if (!file) throw new LiberCliError("ARG_REQUIRED", "Missing manifest path.");
    const manifest = JSON.parse(await readFile(file, "utf8"));
    if (!flags["dry-run"]) {
      const result = await publishBookManifestChunked(manifest, {
        apiUrl: flags["api-url"],
        adminToken: flags["admin-token"],
        configPath: flags.config,
        id: flags.id,
        category: flags.category,
        year: flags.year,
        onProgress: flags.json ? undefined : (event) => {
          if (event.stage === "chapter") {
            process.stderr.write(`Publishing chapter ${event.current}/${event.total}: ${event.chapter.title}\n`);
          } else {
            process.stderr.write(`Publishing ${event.stage}...\n`);
          }
        },
      });
      flags.json ? printJson(result) : process.stdout.write(`Published ${result.book?.id || result.book?.title || "book"} (${result.chapters?.length ?? result.finalize?.chapters ?? "unknown"} chapters)\n`);
      return 0;
    }
    const cfg = await loadCliConfig({ configPath: flags.config });
    const payload = await createIngestPayload(manifest, {
      id: flags.id,
      category: flags.category,
      year: flags.year,
    });
    const plan = dryRunPublishPlan(manifest, { apiUrl: flags["api-url"] || cfg.apiUrl, ingestPayload: payload });
    flags.json ? printJson(plan) : printPlan(plan);
    return 0;
  }

  throw new LiberCliError("UNKNOWN_COMMAND", `Unknown book command: ${action || "(missing)"}.`);
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
}).catch((error) => {
  const code = error instanceof LiberCliError ? error.code : "ERROR";
  process.stderr.write(`${code}: ${error.message}\n`);
  process.exitCode = error instanceof LiberCliError && (error.code === "AUTH_REQUIRED" || error.code === "LICENSE_REJECTED") ? 2 : 1;
});
