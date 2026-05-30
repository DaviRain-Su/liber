#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  dryRunPublishPlan,
  inspectEpub,
  LiberCliError,
  MANIFEST_SCHEMA,
  verifyPublishLicense,
  writeBookManifest,
} from "../src/liber-core.mjs";

function usage() {
  return `Liber CLI

Usage:
  liber license explain
  liber auth status
  liber auth logout
  liber book inspect <file.epub> [--json]
  liber book verify-license <file.epub> --source <url> [--license CC0-1.0|PUBLIC-DOMAIN] [--evidence <text>] [--json]
  liber book package <file.epub> --source <url> --license CC0-1.0|PUBLIC-DOMAIN --out <manifest.json> [--evidence <text>]
  liber book publish <manifest.json> --dry-run [--api-url <url>]
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
    if (key === "json" || key === "dry-run") {
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

function printPlan(plan) {
  process.stdout.write(`Dry-run publish plan

Storage:
  EPUB: ${plan.storage.path}
  SHA-256: ${plan.storage.sha256}
  Size: ${plan.storage.size}

API:
  POST ${plan.api.ingestUrl}
  Payload license: ${plan.api.ingestPayload.license}

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
    if (action === "status") {
      process.stdout.write(`CLI wallet authorization is not configured yet.
Set LIBER_TOKEN for admin API calls in a future publish implementation.
`);
      return 0;
    }
    if (action === "logout") {
      process.stdout.write("No persisted CLI session is stored by this version.\n");
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
    if (!flags["dry-run"]) {
      throw new LiberCliError("PUBLISH_NOT_IMPLEMENTED", "Non-dry-run publish is not implemented yet. Use --dry-run.");
    }
    const manifest = JSON.parse(await readFile(file, "utf8"));
    const plan = dryRunPublishPlan(manifest, { apiUrl: flags["api-url"] });
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
  process.exitCode = error instanceof LiberCliError && error.code === "PUBLISH_NOT_IMPLEMENTED" ? 2 : 1;
});
