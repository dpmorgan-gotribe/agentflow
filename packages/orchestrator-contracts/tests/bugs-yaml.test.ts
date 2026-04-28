import { describe, expect, it } from "vitest";
import {
  BugEntrySchema,
  BugsYamlJsonSchema,
  BugsYamlSchema,
  defaultAgentSequenceForSource,
} from "../src/bugs-yaml.js";

const validOrphanEntry: typeof BugEntrySchema._type = {
  id: "bug-orphan-carddetailmodal",
  iteration: 1,
  source: "reachability-orphan",
  severity: "P0",
  summary: "CardDetailModal exported but never imported in production",
  orphan: {
    componentPath: "apps/web/src/components/board/CardDetailModal.tsx",
    exportNames: ["CardDetailModal"],
    suggestedImporters: ["apps/web/src/components/board/KanbanBoard.tsx"],
  },
  correlatedOrphanPath: null,
  owningFeature: "feat-board-core",
  affectsFiles: [
    "apps/web/src/components/board/CardDetailModal.tsx",
    "apps/web/src/components/board/KanbanBoard.tsx",
  ],
  agentSequence: ["web-frontend-builder", "tester", "reviewer"],
  status: "pending",
  attempts: 0,
  maxAttempts: 3,
  flapResets: 0,
  resolvedInIteration: null,
  bugPlanPath: "plans/active/bug-100-orphan-carddetailmodal.md",
  errorLog: [],
};

const validFlowEntry: typeof BugEntrySchema._type = {
  id: "bug-flow-flow-4-card-modal",
  iteration: 1,
  source: "flow-execution-failure",
  severity: "P0",
  summary:
    "Flow flow-4 (Open detail-edit modal) failed at step 1: expected card-modal, landed on home",
  flow: {
    id: "flow-4",
    name: "Open detail-edit modal",
    failedStep: 1,
    expectedScreenId: "card-modal",
    actualScreenId: "home",
    selector: '[data-kit-component="Card"]',
    screenshot: "test-results/flow-4/screenshot-1.png",
    htmlDump: "test-results/flow-4/page-1.html",
  },
  correlatedOrphanPath: "apps/web/src/components/board/CardDetailModal.tsx",
  owningFeature: "feat-board-core",
  affectsFiles: ["apps/web/src/components/board/KanbanBoard.tsx"],
  agentSequence: ["web-frontend-builder", "tester", "reviewer"],
  status: "pending",
  attempts: 0,
  maxAttempts: 3,
  flapResets: 0,
  resolvedInIteration: null,
  bugPlanPath: "plans/active/bug-101-flow-flow-4-card-modal.md",
  errorLog: [],
};

const validBugsYaml: typeof BugsYamlSchema._type = {
  version: "1.0",
  generated_at: "2026-04-26T12:34:56.000Z",
  project_name: "kanban-webapp-10",
  source_run_id: "run-abc-123",
  iteration: 1,
  iteration_cap: 5,
  bugs: [validOrphanEntry, validFlowEntry],
};

describe("BugEntrySchema", () => {
  it("accepts a happy-path orphan-component bug", () => {
    const parsed = BugEntrySchema.parse(validOrphanEntry);
    expect(parsed.id).toBe("bug-orphan-carddetailmodal");
    expect(parsed.source).toBe("reachability-orphan");
    expect(parsed.orphan?.componentPath).toBe(
      "apps/web/src/components/board/CardDetailModal.tsx",
    );
  });

  it("accepts a happy-path flow-failure bug with correlated orphan", () => {
    const parsed = BugEntrySchema.parse(validFlowEntry);
    expect(parsed.flow?.id).toBe("flow-4");
    expect(parsed.correlatedOrphanPath).toBe(
      "apps/web/src/components/board/CardDetailModal.tsx",
    );
  });

  it("defaults severity, status, attempts, flapResets, errorLog when omitted", () => {
    const parsed = BugEntrySchema.parse({
      id: "bug-orphan-foo",
      iteration: 1,
      source: "reachability-orphan",
      summary: "foo orphan",
      agentSequence: ["web-frontend-builder"],
    });
    expect(parsed.severity).toBe("P0");
    expect(parsed.status).toBe("pending");
    expect(parsed.attempts).toBe(0);
    expect(parsed.maxAttempts).toBe(3);
    expect(parsed.flapResets).toBe(0);
    expect(parsed.resolvedInIteration).toBeNull();
    expect(parsed.errorLog).toEqual([]);
    expect(parsed.affectsFiles).toEqual([]);
  });

  it("rejects malformed bug id (must match grammar)", () => {
    expect(() =>
      BugEntrySchema.parse({ ...validOrphanEntry, id: "bug-XX-foo" }),
    ).toThrow();
    expect(() =>
      BugEntrySchema.parse({ ...validOrphanEntry, id: "bug-flow-Bad_Id" }),
    ).toThrow();
  });

  it("rejects iteration < 1", () => {
    expect(() =>
      BugEntrySchema.parse({ ...validOrphanEntry, iteration: 0 }),
    ).toThrow();
  });

  it("rejects empty agentSequence", () => {
    expect(() =>
      BugEntrySchema.parse({ ...validOrphanEntry, agentSequence: [] }),
    ).toThrow();
  });

  it("rejects unknown agent in agentSequence", () => {
    expect(() =>
      BugEntrySchema.parse({
        ...validOrphanEntry,
        agentSequence: ["web-frontend-builder", "imaginary-agent"],
      }),
    ).toThrow();
  });

  it("rejects unknown source enum value", () => {
    expect(() =>
      BugEntrySchema.parse({ ...validOrphanEntry, source: "made-up" }),
    ).toThrow();
  });

  it("rejects summary > 200 chars", () => {
    expect(() =>
      BugEntrySchema.parse({ ...validOrphanEntry, summary: "x".repeat(201) }),
    ).toThrow();
  });
});

describe("BugsYamlSchema", () => {
  it("accepts a happy-path bugs.yaml document", () => {
    const parsed = BugsYamlSchema.parse(validBugsYaml);
    expect(parsed.bugs).toHaveLength(2);
    expect(parsed.iteration_cap).toBe(5);
  });

  it("defaults iteration_cap to 5 + bugs to []", () => {
    const parsed = BugsYamlSchema.parse({
      version: "1.0",
      generated_at: "2026-04-26T00:00:00Z",
      project_name: "demo",
      source_run_id: "run-1",
      iteration: 1,
    });
    expect(parsed.iteration_cap).toBe(5);
    expect(parsed.bugs).toEqual([]);
  });

  it("rejects version !== '1.0'", () => {
    expect(() =>
      BugsYamlSchema.parse({ ...validBugsYaml, version: "2.0" }),
    ).toThrow();
  });

  it("rejects empty project_name", () => {
    expect(() =>
      BugsYamlSchema.parse({ ...validBugsYaml, project_name: "" }),
    ).toThrow();
  });
});

describe("BugsYamlJsonSchema (Zod-generated)", () => {
  it("is a valid object schema with the documented top-level fields", () => {
    const schema = BugsYamlJsonSchema as Record<string, unknown>;
    expect(schema.type).toBe("object");
    const props = schema.properties as Record<string, unknown>;
    expect(props.version).toBeDefined();
    expect(props.project_name).toBeDefined();
    expect(props.iteration).toBeDefined();
    expect(props.iteration_cap).toBeDefined();
    expect(props.bugs).toBeDefined();
  });
});

describe("defaultAgentSequenceForSource", () => {
  it("returns the web-frontend-builder sequence for orphan + flow + coverage", () => {
    expect(defaultAgentSequenceForSource("reachability-orphan")).toEqual([
      "web-frontend-builder",
      "tester",
      "reviewer",
    ]);
    expect(defaultAgentSequenceForSource("flow-execution-failure")).toEqual([
      "web-frontend-builder",
      "tester",
      "reviewer",
    ]);
    expect(defaultAgentSequenceForSource("pm-coverage-omission")).toEqual([
      "web-frontend-builder",
      "tester",
      "reviewer",
    ]);
  });
});
