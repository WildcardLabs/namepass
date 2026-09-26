import { useEffect, useRef, useState } from "react";

/** Copy feedback is shared by deposit fields, token contracts and flow details. */
export function useCopyFeedback() {
	const [copied, setCopied] = useState<string | null>(null);
	const [error, setError] = useState<{ value: string; message: string } | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout>>();
	const request = useRef(0);

	useEffect(() => () => {
		request.current++;
		clearTimeout(timer.current);
	}, []);

	async function copy(value: string) {
		const current = ++request.current;
		clearTimeout(timer.current);
		setCopied(null);
		setError(null);
		try {
			await navigator.clipboard.writeText(value);
			if (current !== request.current) return;
			setCopied(value);
			timer.current = setTimeout(() => setCopied(null), 1600);
		} catch {
			if (current !== request.current) return;
			setError({ value, message: "Could not copy. Select the value and copy it manually." });
		}
	}

	return { copied, error, copy };
}
