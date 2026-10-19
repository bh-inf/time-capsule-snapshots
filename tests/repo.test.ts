import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSchemaText, trendsUrlPattern } from "@time-capsule/schema";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("frozen schema and registry", () => {
  it("publishes the exact minor schemas and does not hard-code geo=TW", () => {
    expect(read("v1/schema/snapshot-v1.0.json")).toBe(readSchemaText("snapshot-v1.0.json"));
    expect(read("v1/schema/snapshot-v1.1.json")).toBe(readSchemaText("snapshot-v1.1.json"));
    expect(trendsUrlPattern()).toBe("^https://\\S+$");
    expect(trendsUrlPattern()).not.toContain("geo=TW");
    const registry = read("fixtures/registry/v1/price-items.json");
    expect(read("v1/TW/registry/price-items.json")).toBe(registry);
    expect(read("v1/TW/registry/price-items.v1.json")).toBe(registry);
    const parsed = JSON.parse(registry) as { items: Array<{ key: string; unit: string; definition: string }> };
    expect(parsed.items.map((item) => [item.key, item.unit])).toEqual([
      ["egg_kg", "TWD/kg"],
      ["mrt_tpe_min_fare", "TWD/trip"],
      ["bento_tpe", "TWD"],
    ]);
    for (const item of parsed.items) expect(item.definition.length).toBeGreaterThan(10);
  });

  it("pins canonicalize to 2.1.0 and tells Dependabot to ignore it", () => {
    const pkg = JSON.parse(read("packages/schema/package.json")) as { dependencies: { canonicalize: string } };
    expect(pkg.dependencies.canonicalize).toBe("2.1.0");
    const dependabot = read(".github/dependabot.yml");
    expect(dependabot).toContain("canonicalize");
    expect(dependabot).toContain("version-update:semver-major");
    expect(dependabot).toContain("version-update:semver-minor");
    expect(dependabot).toContain("default-days: 7");
    const lock = read("pnpm-lock.yaml");
    expect(lock).toContain("canonicalize@2.1.0");
    expect(lock).not.toMatch(/canonicalize@2\.(?!1\.0)/);
  });
});

describe("workflow guards", () => {
  it("keeps the daily job on the publish environment and checks before push", () => {
    const workflow = read(".github/workflows/snapshot.yml");
    const ci = read(".github/workflows/ci.yml");
    expect(workflow).not.toContain("pull_request_target");
    expect(ci).not.toContain("pull_request_target");
    expect(workflow).not.toContain("autostash");
    expect(read("scripts/publish-snapshot.sh")).not.toContain("autostash");
    expect(workflow).not.toMatch(/contents:\s*write/);
    expect(ci).not.toMatch(/contents:\s*write/);
    const checkouts = workflow.match(/actions\/checkout/g) ?? [];
    const persisted = workflow.match(/persist-credentials:\s*false/g) ?? [];
    expect(persisted.length).toBeGreaterThanOrEqual(checkouts.length);
    expect(ci.match(/persist-credentials:\s*false/g)?.length).toBe(4);
    expect(workflow.match(/environment:\s*snapshot-publish/g)?.length).toBe(2);
    for (const name of ["SNAPSHOT_DEPLOY_KEY", "CWA_API_KEY", "SNAPSHOT_SIGNING_KEY_HEX", "SNAPSHOT_SIGNING_KEY_ID"]) {
      expect(workflow).toContain(name);
    }
    expect(workflow.indexOf("pnpm snapshot:canary")).toBeLessThan(workflow.indexOf("upload-artifact"));
    expect(workflow.indexOf("upload-artifact")).toBeLessThan(workflow.indexOf("publish:"));
    expect(workflow).toContain('SNAPSHOT_REQUIRE_SIGNATURE: "1"');
  });
});

describe("publish script", () => {
  it("does not push conflict markers or rewritten date files", () => {
    const dir = mkdtempSync(join(tmpdir(), "snapshot-publish-"));
    const bare = join(dir, "bare.git");
    const work = join(dir, "work");
    execFileSync("git", ["init", "--bare", "-b", "main", bare]);
    execFileSync("git", ["init", "-b", "main", work]);
    const git = (args: string[]) =>
      execFileSync("git", args, {
        cwd: work,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "test",
          GIT_AUTHOR_EMAIL: "test@example.com",
          GIT_COMMITTER_NAME: "test",
          GIT_COMMITTER_EMAIL: "test@example.com",
        },
      });
    git(["remote", "add", "origin", bare]);
    mkdirSync(join(work, "v1", "TW"), { recursive: true });
    mkdirSync(join(work, "scripts"), { recursive: true });
    writeFileSync(join(work, "v1", "TW", "index.json"), '{"schema_version":1,"region":"TW","dates":[],"latest":null}\n');
    writeFileSync(join(work, "README.md"), "archive\n");
    cpSync("scripts/apply-snapshot-tree.py", join(work, "scripts", "apply-snapshot-tree.py"));
    cpSync("scripts/pre-push-check.py", join(work, "scripts", "pre-push-check.py"));
    cpSync("scripts/publish-snapshot.sh", join(work, "scripts", "publish-snapshot.sh"));
    git(["add", "."]);
    git(["commit", "-m", "init"]);
    git(["push", "origin", "HEAD:main"]);
    const before = execFileSync("git", ["rev-parse", "main"], { cwd: bare, encoding: "utf8" });
    const publishEnv = {
      ...process.env,
      GITHUB_REF: "refs/heads/main",
      SNAPSHOT_PUBLISH_REMOTE: bare,
    };

    const bad = join(dir, "bad");
    mkdirSync(join(bad, "v1", "TW", "2026"), { recursive: true });
    writeFileSync(join(bad, "v1", "TW", "2026", "2026-10-18.json"), '{"ok": true,\n<<<<<<<\n}\n');
    writeFileSync(join(bad, "v1", "TW", "index.json"), '{"schema_version":1,"region":"TW","dates":["2026-10-18"],"latest":"2026-10-18"}\n');
    expect(() =>
      execFileSync("bash", ["scripts/publish-snapshot.sh", bad, "."], { cwd: work, env: publishEnv }),
    ).toThrow();
    expect(execFileSync("git", ["rev-parse", "main"], { cwd: bare, encoding: "utf8" })).toBe(before);

    const good = join(dir, "good");
    mkdirSync(join(good, "v1", "TW", "2026"), { recursive: true });
    writeFileSync(join(good, "v1", "TW", "2026", "2026-10-18.json"), '{"schema_version":1,"date":"2026-10-18"}\n');
    writeFileSync(join(good, "v1", "TW", "index.json"), '{"schema_version":1,"region":"TW","dates":["2026-10-18"],"latest":"2026-10-18"}\n');
    execFileSync("bash", ["scripts/publish-snapshot.sh", good, "."], {
      cwd: work,
      env: publishEnv,
    });
    const published = execFileSync("git", ["show", "main:v1/TW/2026/2026-10-18.json"], { cwd: bare, encoding: "utf8" });
    expect(published).toContain("2026-10-18");
    expect(published).not.toContain("<<<<<<<");

    const changed = join(dir, "changed");
    mkdirSync(join(changed, "v1", "TW", "2026"), { recursive: true });
    writeFileSync(join(changed, "v1", "TW", "2026", "2026-10-18.json"), '{"schema_version":1,"date":"changed"}\n');
    writeFileSync(join(changed, "v1", "TW", "index.json"), '{"schema_version":1,"region":"TW","dates":["2026-10-18"],"latest":"2026-10-18"}\n');
    expect(() =>
      execFileSync("bash", ["scripts/publish-snapshot.sh", changed, "."], {
        cwd: work,
        env: publishEnv,
      }),
    ).toThrow();
  });
});
