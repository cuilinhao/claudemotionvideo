import { describe, expect, it } from "vitest";
import { estimateGenerationCost } from "../src/lib/generation-cost";

describe("generation credit estimates", () => {
  it("matches new-generation costs for duration and reference images", () => {
    expect(estimateGenerationCost({ duration: 10, assetIds: [] })).toBe(80);
    expect(estimateGenerationCost({ duration: 15, assetIds: ["a"] })).toBe(160);
    expect(estimateGenerationCost({ duration: 30, assetIds: ["a", "b", "c"] })).toBe(260);
  });

  it("matches text edits and charges only for newly added reference images", () => {
    expect(estimateGenerationCost({ duration: 10, assetIds: [], previousAssetIds: [] })).toBe(20);
    expect(estimateGenerationCost({ duration: 10, assetIds: ["a"], previousAssetIds: ["a"] })).toBe(40);
    expect(estimateGenerationCost({ duration: 10, assetIds: ["a", "b"], previousAssetIds: ["a"] })).toBe(60);
  });
});
