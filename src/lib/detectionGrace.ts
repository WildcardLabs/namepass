import type { HoldReason } from "./readModel";

export const DETECTION_GRACE_MS = 20_000;
export const DETECTION_GRACE_READS = 2;

export interface DetectionObservation {
	firstSeenAt: number;
	reads: number;
}

export type DetectionObservations = Record<string, DetectionObservation>;

export function updateDetectionObservations(
	current: DetectionObservations,
	chainIds: readonly string[],
	now: number,
): DetectionObservations {
	return Object.fromEntries(chainIds.map((chainId) => {
		const observation = current[chainId];
		return [chainId, observation
			? { ...observation, reads: observation.reads + 1 }
			: { firstSeenAt: now, reads: 1 }];
	}));
}

export function isDetectionPending(
	reason: HoldReason,
	triggerable: boolean,
	observation: DetectionObservation | undefined,
	now: number,
): boolean {
	if (reason !== "not_detected" || !triggerable) return false;
	if (!observation || observation.reads < DETECTION_GRACE_READS) return true;
	return now - observation.firstSeenAt < DETECTION_GRACE_MS;
}
