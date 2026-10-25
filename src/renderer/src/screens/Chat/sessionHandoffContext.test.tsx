import { describe, expect, it } from "vitest";
import type { HandoffSessionContext } from "./sessionHandoff";
import { mintRun } from "../Layout/chatRuns";
import { writePlanMode, readPlanMode } from "./planMode";
import { writeOnFinishSelection, readOnFinishSelection } from "./onFinish";

describe("New session with context inheritance", () => {
  it("carries context folders, model override, reasoning, on-finish, knowledge, and planMode", () => {
    const context: HandoffSessionContext = {
      contextFolders: ["/workspace/my-project"],
      modelOverride: {
        model: "gpt-4o",
        provider: "openai",
        baseUrl: "https://api.openai.com",
      },
      reasoningEffort: "high",
      onFinishSelected: ["cmd-1", "cmd-2"],
      knowledgeBundles: ["docs-bundle"],
      planMode: true,
    };

    const run = mintRun("default", undefined, context.contextFolders);
    run.title = "Handoff session";
    run.initialModelOverride = context.modelOverride;
    run.initialKnowledgeBundles = context.knowledgeBundles;

    expect(run.initialContextFolders).toEqual(["/workspace/my-project"]);
    expect(run.initialModelOverride).toEqual({
      model: "gpt-4o",
      provider: "openai",
      baseUrl: "https://api.openai.com",
    });
    expect(run.initialKnowledgeBundles).toEqual(["docs-bundle"]);

    writePlanMode(run.runId, context.planMode!);
    expect(readPlanMode(run.runId)).toBe(true);

    writeOnFinishSelection(context.onFinishSelected!, run.runId);
    expect(readOnFinishSelection(run.runId)).toEqual(["cmd-1", "cmd-2"]);

    const rKey = JSON.stringify(["hermes.chat.reasoning.v1", "default", run.runId]);
    localStorage.setItem(rKey, context.reasoningEffort!);
    expect(localStorage.getItem(rKey)).toBe("high");
  });
});
