import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import PassCard from "../components/PassCard";
import { encodeQR } from "./qr";

test("the deposit card keeps every QR module and the full address beside the normalized subdomain", () => {
	const address = "0x043c184003266644372bA5fA4946777b3f1cFC3D";
	const html = renderToStaticMarkup(createElement(PassCard, {
		name: "Vitalik.eth", address, onSupportedTokens: () => {},
	}));
	expect(html).toContain("vitalik.namepass.eth");
	expect(html).toContain(`>${address}</span>`);
	const qr = html.match(/<svg[^>]*aria-label="QR code[^>]*>(.*?)<\/svg>/)?.[1];
	expect(qr).toBeDefined();
	expect(qr).not.toContain("<rect");
	const modules = [...qr!.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((match) => `${match[1]},${match[2]}`);
	const expected = encodeQR(address).flatMap((row, y) => row.flatMap((on, x) => on ? [`${x},${y}`] : []));
	expect(modules).toEqual(expected);
});
