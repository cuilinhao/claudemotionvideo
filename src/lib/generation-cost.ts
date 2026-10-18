export function estimateGenerationCost(input: {
  duration: 10 | 15 | 30;
  assetIds: string[];
  previousAssetIds?: string[];
}): number {
  if (input.previousAssetIds !== undefined) {
    const previous = new Set(input.previousAssetIds);
    const newAssetCount = input.assetIds.filter((id) => !previous.has(id)).length;
    return (input.assetIds.length ? 40 : 20) + newAssetCount * 20;
  }

  const base = input.duration === 10 ? 80 : input.duration === 15 ? 100 : 160;
  return base + (input.assetIds.length ? 60 + (input.assetIds.length - 1) * 20 : 0);
}
