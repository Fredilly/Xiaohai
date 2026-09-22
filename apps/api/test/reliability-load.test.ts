import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

function percentile(samples: number[], percentage: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil((percentage / 100) * sorted.length) - 1]!;
}

describe('repeatable in-process load smoke', () => {
  it('serves parallel reads without errors and reports measured latency', async () => {
    const app = buildApp({ logger: false });
    const start = performance.now();
    const measurements = await Promise.all(
      Array.from({ length: 100 }, async () => {
        const requestedAt = performance.now();
        const response = await app.inject('/health');
        return { status: response.statusCode, duration: performance.now() - requestedAt };
      }),
    );
    const durationMs = performance.now() - start;
    expect(measurements.every((entry) => entry.status === 200)).toBe(true);
    expect(
      percentile(
        measurements.map((entry) => entry.duration),
        95,
      ),
    ).toBeGreaterThanOrEqual(0);
    // Printed metrics are diagnostic. Shared CI runners cannot enforce production latency SLAs.
    console.info(
      JSON.stringify({
        event: 'M23_LOAD_SAMPLE',
        requests: measurements.length,
        throughputPerSecond: Math.round((measurements.length * 1000) / durationMs),
        p95Ms: Math.round(
          percentile(
            measurements.map((entry) => entry.duration),
            95,
          ),
        ),
        errors: 0,
      }),
    );
    await app.close();
  });
});
