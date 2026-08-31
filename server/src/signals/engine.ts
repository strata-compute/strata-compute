import type { Signal } from "../types/signals.ts";
import { describeError, logger } from "../utils/logger.ts";
import { DETECTORS } from "./detectors/index.ts";
import type { DetectorInput, SignalDetector } from "./types.ts";

/**
 * Runs every registered detector over every asset in a pass. A detector that
 * throws is logged and skipped — one faulty rule must not stop the feed.
 */

export interface SignalRunResult {
  signals: Signal[];
  detectorsRun: number;
  failures: number;
}

export function runDetectors(
  inputs: DetectorInput[],
  detectors: SignalDetector[] = DETECTORS,
): SignalRunResult {
  const signals: Signal[] = [];
  let failures = 0;

  for (const input of inputs) {
    for (const detector of detectors) {
      try {
        const signal = detector.detect(input);
        if (signal) signals.push(signal);
      } catch (error) {
        failures += 1;
        logger.error("signal detector failed", {
          asset: input.symbol,
          detector: detector.type,
          ...describeError(error),
        });
      }
    }
  }

  // strongest first, so a truncated feed still shows what matters
  signals.sort((a, b) => b.value - a.value);

  return { signals, detectorsRun: detectors.length, failures };
}

export function listDetectors(): { type: string; description: string }[] {
  return DETECTORS.map((d) => ({ type: d.type, description: d.description }));
}
