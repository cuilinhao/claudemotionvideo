import { describe, expect, it } from 'vitest';
import { estimateGenerationPayment } from '../src/lib/generation-cost';

describe('generation payment selection', () => {
  it('uses one purchased generation for every supported duration and up to four images', () => {
    for (const duration of [10, 15, 30] as const) {
      expect(estimateGenerationPayment({ duration, assetIds: ['a', 'b', 'c', 'd'], singleVideoGenerations: 1 }))
        .toEqual({ paymentType: 'single_video', cost: 0, label: '1 video generation' });
    }
  });

  it('uses credits for edits even when purchased generations remain', () => {
    expect(estimateGenerationPayment({ duration: 30, assetIds: ['a', 'b'], previousAssetIds: ['a'], singleVideoGenerations: 2 }))
      .toEqual({ paymentType: 'credits', cost: 60, label: '60 credits' });
  });

  it('uses the credit estimate when no purchased generation is available', () => {
    expect(estimateGenerationPayment({ duration: 15, assetIds: ['a'], singleVideoGenerations: 0 }))
      .toEqual({ paymentType: 'credits', cost: 160, label: '160 credits' });
  });
});
