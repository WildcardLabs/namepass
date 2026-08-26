import type { ActivityRead, NameActivityRead } from "./publicApi";

type EventFact = { eventId: string; blockTime: string };

function mergeByEvent<T>(
	current: readonly T[],
	incoming: readonly T[],
	event: (item: T) => EventFact,
): T[] {
	const merged = new Map(current.map((item) => [event(item).eventId, item]));
	for (const item of incoming) merged.set(event(item).eventId, item);
	return [...merged.values()].sort(
		(left, right) => new Date(event(right).blockTime).getTime() - new Date(event(left).blockTime).getTime(),
	);
}

export function mergeActivityHistory(
	current: ActivityRead["items"],
	incoming: ActivityRead["items"],
): ActivityRead["items"] {
	return mergeByEvent(current, incoming, (item) => item.renewal);
}

export function mergeNameHistory(
	current: NameActivityRead["renewals"],
	incoming: NameActivityRead["renewals"],
): NameActivityRead["renewals"] {
	return mergeByEvent(current, incoming, (renewal) => renewal);
}
