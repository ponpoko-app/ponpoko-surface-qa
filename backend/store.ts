import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PoAnswers, Project, ProjectTarget, QaCase, RunRecord } from "../src/contracts/qa";
import { readCases, readProject, readRun, asRow } from "../src/contracts/readers";
import { requireString, type Env, type Registry, type Row } from "./rpc";
import { parseCase, serializeCase } from "./cases";
import { draftCases } from "./interview";

export function projectSlug(appId: string): string {
  const clean = appId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const digest = createHash("sha1").update(appId).digest("hex").slice(0, 8);
  return `${clean.length > 0 ? clean : "target"}-${digest}`;
}

function storePath(parent: string, name: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}(?:\.(?:json|yaml|png))?$/.test(name) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error("Invalid QA storage name.");
  }
  const path = join(parent, name);
  if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error("QA storage refuses symbolic links.");
  }
  return path;
}

function identifier(value: string): string {
  if (!/^[a-z0-9_-]{1,120}$/i.test(value)) throw new Error("Invalid QA storage identifier.");
  return value;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

export class QaStore {
  readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  root(projectId: string): string {
    return storePath(storePath(this.dataDir, "projects"), identifier(projectId));
  }

  projectPaths(projectId: string): { root: string; cases: string; baselines: string; runs: string } {
    const root = this.root(projectId);
    return {
      root,
      cases: storePath(root, "cases"),
      baselines: storePath(root, "baselines"),
      runs: storePath(root, "runs"),
    };
  }

  list(): Project[] {
    const base = storePath(this.dataDir, "projects");
    if (!existsSync(base)) return [];
    const projects: Project[] = [];
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = storePath(storePath(base, identifier(entry.name)), "project.json");
      if (!existsSync(file)) continue;
      projects.push(readProject(readJson(file)));
    }
    return projects.sort((left, right) => right.updated_at - left.updated_at);
  }

  project(projectId: string): Project | null {
    const file = storePath(this.root(projectId), "project.json");
    if (!existsSync(file)) return null;
    return readProject(readJson(file));
  }

  open(input: { target: ProjectTarget; answers: PoAnswers; capability: Project["capability"] }): Project {
    const projectId = projectSlug(input.target.app_id);
    const existing = this.project(projectId);
    const now = Date.now();
    const project: Project = {
      project_id: projectId,
      name: input.target.name,
      target: input.target,
      capability: input.capability,
      answers: input.answers,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    return this.save(project);
  }

  save(project: Project): Project {
    const paths = this.projectPaths(project.project_id);
    mkdirSync(paths.root, { recursive: true });
    writeJson(storePath(paths.root, "project.json"), { ...project, updated_at: Date.now() });
    return project;
  }

  cases(projectId: string): QaCase[] {
    const paths = this.projectPaths(projectId);
    if (!existsSync(paths.cases)) return [];
    return readdirSync(paths.cases)
      .filter((file) => file.endsWith(".yaml"))
      .sort()
      .map((file) => parseCase(readFileSync(storePath(paths.cases, file), "utf8")));
  }

  writeCases(projectId: string, cases: QaCase[]): QaCase[] {
    const paths = this.projectPaths(projectId);
    mkdirSync(paths.cases, { recursive: true });
    const files = cases.map((testCase) => ({
      path: storePath(paths.cases, `${identifier(testCase.id)}.yaml`),
      text: serializeCase(testCase),
    }));
    for (const file of files) writeFileSync(file.path, file.text, "utf8");
    return this.cases(projectId);
  }

  baselineGet(projectId: string, caseId: string, stepId: string): string | null {
    const file = storePath(storePath(this.projectPaths(projectId).baselines, identifier(caseId)), `${identifier(stepId)}.png`);
    if (!existsSync(file)) return null;
    return readFileSync(file).toString("base64");
  }

  baselinePut(projectId: string, caseId: string, stepId: string, base64: string): string {
    const dir = storePath(this.projectPaths(projectId).baselines, identifier(caseId));
    mkdirSync(dir, { recursive: true });
    const file = storePath(dir, `${identifier(stepId)}.png`);
    writeFileSync(file, Buffer.from(base64, "base64"));
    return file;
  }

  recordRun(run: RunRecord): string {
    const dir = storePath(this.projectPaths(run.project_id).runs, identifier(run.run_id));
    mkdirSync(dir, { recursive: true });
    const file = storePath(dir, "run.json");
    writeJson(file, run);
    return file;
  }

  runs(projectId: string): RunRecord[] {
    const dir = this.projectPaths(projectId).runs;
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => storePath(storePath(dir, identifier(entry.name)), "run.json"))
      .filter((file) => existsSync(file))
      .map((file) => readRun(readJson(file)))
      .sort((left, right) => right.started_at - left.started_at);
  }
}

export function storeMethods(env: Env): Registry {
  const store = new QaStore(env.dataDir);
  const projectOf = (params: Row): string => requireString(params, "project_id");
  return {
    "qa.project.list": async () => store.list(),
    "qa.project.open": async (params) => {
      const target = asRow(params.target, "the target") as unknown as ProjectTarget;
      return store.open({
        target,
        answers: asRow(params.answers, "the PO answers") as unknown as PoAnswers,
        capability: asRow(params.capability, "the capability") as unknown as Project["capability"],
      });
    },
    "qa.project.save": async (params) => store.save(readProject(params.project)),
    "qa.cases.read": async (params) => store.cases(projectOf(params)),
    "qa.cases.write": async (params) => store.writeCases(projectOf(params), readCases(params.cases)),
    "qa.cases.draft": async (params) =>
      draftCases(
        asRow(params.answers, "the PO answers") as unknown as PoAnswers,
        asRow(params.target, "the target") as unknown as ProjectTarget,
        Date.now(),
      ),
    "qa.baseline.get": async (params) =>
      store.baselineGet(projectOf(params), requireString(params, "case_id"), requireString(params, "step_id")),
    "qa.baseline.put": async (params) =>
      store.baselinePut(
        projectOf(params),
        requireString(params, "case_id"),
        requireString(params, "step_id"),
        requireString(params, "base64"),
      ),
    "qa.run.record": async (params) => store.recordRun(readRun(params.run)),
    "qa.run.list": async (params) => store.runs(projectOf(params)),
  };
}
