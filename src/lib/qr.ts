/**
 * Minimal, dependency-free QR Code encoder.
 *
 * Scope: byte mode, error correction level M, versions 1–10 (auto-selected).
 * That covers a 42-character Ethereum address (v3) and ENS names comfortably.
 *
 * Implements: Reed–Solomon ECC over GF(256), block interleaving, all 8 data
 * masks with penalty scoring, and full function-pattern placement.
 */

/* ---------------- GF(256) arithmetic ---------------- */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
	let x = 1;
	for (let i = 0; i < 255; i++) {
		EXP[i] = x;
		LOG[x] = i;
		x <<= 1;
		if (x & 0x100) x ^= 0x11d;
	}
	for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const gfMul = (a: number, b: number) =>
	a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];

function rsGeneratorPoly(degree: number): Uint8Array {
	let poly = new Uint8Array([1]);
	for (let i = 0; i < degree; i++) {
		const next = new Uint8Array(poly.length + 1);
		for (let j = 0; j < poly.length; j++) {
			next[j] ^= poly[j];
			next[j + 1] ^= gfMul(poly[j], EXP[i]);
		}
		poly = next;
	}
	return poly;
}

function rsEncode(data: Uint8Array, ecLen: number): Uint8Array {
	const gen = rsGeneratorPoly(ecLen);
	const res = new Uint8Array(ecLen);
	for (const byte of data) {
		const factor = byte ^ res[0];
		res.copyWithin(0, 1);
		res[ecLen - 1] = 0;
		for (let i = 0; i < ecLen; i++) res[i] ^= gfMul(gen[i + 1], factor);
	}
	return res;
}

/* ---------------- version tables (EC level M) ---------------- */

/** [totalCodewords, ecCodewordsPerBlock, group1Blocks, group1DataCw, group2Blocks, group2DataCw] */
const VERSIONS: Record<number, [number, number, number, number, number, number]> = {
	1: [26, 10, 1, 16, 0, 0],
	2: [44, 16, 1, 28, 0, 0],
	3: [70, 26, 1, 44, 0, 0],
	4: [100, 18, 2, 32, 0, 0],
	5: [134, 24, 2, 43, 0, 0],
	6: [172, 16, 4, 27, 0, 0],
	7: [196, 18, 4, 31, 0, 0],
	8: [242, 22, 2, 38, 2, 39],
	9: [292, 22, 3, 36, 2, 37],
	10: [346, 26, 4, 43, 1, 44],
};

const ALIGN_POS: Record<number, number[]> = {
	1: [],
	2: [6, 18],
	3: [6, 22],
	4: [6, 26],
	5: [6, 30],
	6: [6, 34],
	7: [6, 22, 38],
	8: [6, 24, 42],
	9: [6, 26, 46],
	10: [6, 28, 50],
};

/** Format info bits for EC level M, mask 0–7 (pre-computed, BCH encoded). */
const FORMAT_M = [
	0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0,
];

function capacityBytes(version: number): number {
	const [, ecLen, g1, g1d, g2, g2d] = VERSIONS[version];
	void ecLen;
	return g1 * g1d + g2 * g2d;
}

/* ---------------- bit stream ---------------- */

class BitBuffer {
	bits: number[] = [];
	put(value: number, length: number) {
		for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
	}
	get length() {
		return this.bits.length;
	}
}

/* ---------------- matrix construction ---------------- */

type Grid = Int8Array[]; // -1 = empty, 0/1 = module

function newGrid(size: number): Grid {
	return Array.from({ length: size }, () => new Int8Array(size).fill(-1));
}

function placeFinder(grid: Grid, row: number, col: number) {
	for (let r = -1; r <= 7; r++) {
		for (let c = -1; c <= 7; c++) {
			const rr = row + r;
			const cc = col + c;
			if (rr < 0 || cc < 0 || rr >= grid.length || cc >= grid.length) continue;
			const inRing =
				(r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
				(c >= 0 && c <= 6 && (r === 0 || r === 6));
			const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
			grid[rr][cc] = inRing || inCore ? 1 : 0;
		}
	}
}

function buildMatrix(version: number, dataBits: number[], mask: number): Grid {
	const size = version * 4 + 17;
	const grid = newGrid(size);

	placeFinder(grid, 0, 0);
	placeFinder(grid, 0, size - 7);
	placeFinder(grid, size - 7, 0);

	/* timing patterns */
	for (let i = 8; i < size - 8; i++) {
		const v = i % 2 === 0 ? 1 : 0;
		if (grid[6][i] === -1) grid[6][i] = v;
		if (grid[i][6] === -1) grid[i][6] = v;
	}

	/* alignment patterns */
	const positions = ALIGN_POS[version];
	for (const r of positions) {
		for (const c of positions) {
			const isFinderCorner =
				(r <= 8 && c <= 8) ||
				(r <= 8 && c >= size - 9) ||
				(r >= size - 9 && c <= 8);
			if (isFinderCorner) continue;
			for (let dr = -2; dr <= 2; dr++) {
				for (let dc = -2; dc <= 2; dc++) {
					const ring = Math.max(Math.abs(dr), Math.abs(dc));
					grid[r + dr][c + dc] = ring === 1 ? 0 : 1;
				}
			}
		}
	}

	/* dark module */
	grid[size - 8][8] = 1;

	/* reserve format areas */
	for (let i = 0; i < 9; i++) {
		if (grid[8][i] === -1) grid[8][i] = 0;
		if (grid[i][8] === -1) grid[i][8] = 0;
	}
	for (let i = 0; i < 8; i++) {
		if (grid[8][size - 1 - i] === -1) grid[8][size - 1 - i] = 0;
		if (grid[size - 1 - i][8] === -1) grid[size - 1 - i][8] = 0;
	}

	/* mark reserved cells so data placement skips them */
	const reserved = grid.map((row) => Int8Array.from(row, (v) => (v === -1 ? 0 : 1)));

	/* place data in the zig-zag pattern */
	let bitIndex = 0;
	let upward = true;
	for (let col = size - 1; col > 0; col -= 2) {
		if (col === 6) col--; // skip vertical timing column
		for (let i = 0; i < size; i++) {
			const row = upward ? size - 1 - i : i;
			for (let c = 0; c < 2; c++) {
				const cc = col - c;
				if (reserved[row][cc]) continue;
				let bit = bitIndex < dataBits.length ? dataBits[bitIndex] : 0;
				bitIndex++;
				/* apply mask */
				let invert = false;
				switch (mask) {
					case 0: invert = (row + cc) % 2 === 0; break;
					case 1: invert = row % 2 === 0; break;
					case 2: invert = cc % 3 === 0; break;
					case 3: invert = (row + cc) % 3 === 0; break;
					case 4: invert = (Math.floor(row / 2) + Math.floor(cc / 3)) % 2 === 0; break;
					case 5: invert = ((row * cc) % 2) + ((row * cc) % 3) === 0; break;
					case 6: invert = (((row * cc) % 2) + ((row * cc) % 3)) % 2 === 0; break;
					default: invert = (((row + cc) % 2) + ((row * cc) % 3)) % 2 === 0; break;
				}
				if (invert) bit ^= 1;
				grid[row][cc] = bit as 0 | 1;
			}
		}
		upward = !upward;
	}

	/* format information */
	const fmt = FORMAT_M[mask];
	for (let i = 0; i < 15; i++) {
		const bit = ((fmt >> i) & 1) as 0 | 1;
		if (i < 6) grid[8][i] = bit;
		else if (i < 8) grid[8][i + 1] = bit;
		else if (i === 8) grid[7][8] = bit;
		else grid[14 - i][8] = bit;

		if (i < 8) grid[size - 1 - i][8] = bit;
		else grid[8][size - 15 + i] = bit;
	}

	/* The dark module is fixed and must survive format-info placement. */
	grid[size - 8][8] = 1;

	return grid;
}

function penalty(grid: Grid): number {
	const n = grid.length;
	let score = 0;

	/* rule 1: runs of 5+ */
	for (let i = 0; i < n; i++) {
		for (const isRow of [true, false]) {
			let run = 1;
			for (let j = 1; j < n; j++) {
				const prev = isRow ? grid[i][j - 1] : grid[j - 1][i];
				const cur = isRow ? grid[i][j] : grid[j][i];
				if (cur === prev) {
					run++;
				} else {
					if (run >= 5) score += 3 + (run - 5);
					run = 1;
				}
			}
			if (run >= 5) score += 3 + (run - 5);
		}
	}

	/* rule 2: 2x2 blocks */
	for (let r = 0; r < n - 1; r++) {
		for (let c = 0; c < n - 1; c++) {
			const v = grid[r][c];
			if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1])
				score += 3;
		}
	}

	/* rule 4: dark ratio */
	let dark = 0;
	for (const row of grid) for (const v of row) if (v === 1) dark++;
	const pct = (dark * 100) / (n * n);
	score += Math.floor(Math.abs(pct - 50) / 5) * 10;

	return score;
}

/**
 * Encode a string as a QR matrix of booleans (true = dark module).
 */
export function encodeQR(text: string): boolean[][] {
	const bytes = new TextEncoder().encode(text);

	/* pick the smallest version that fits */
	let version = 1;
	while (version <= 10) {
		const cap = capacityBytes(version);
		const headerBits = 4 + (version < 10 ? 8 : 16);
		if (Math.ceil((headerBits + bytes.length * 8) / 8) <= cap) break;
		version++;
	}
	if (version > 10) throw new Error("QR payload too large");

	const [, ecLen, g1, g1d, g2, g2d] = VERSIONS[version];
	const totalData = capacityBytes(version);

	/* build the bit stream */
	const bb = new BitBuffer();
	bb.put(0b0100, 4); // byte mode
	bb.put(bytes.length, version < 10 ? 8 : 16);
	for (const b of bytes) bb.put(b, 8);

	const capacityBits = totalData * 8;
	const terminator = Math.min(4, capacityBits - bb.length);
	bb.put(0, terminator);
	while (bb.length % 8 !== 0) bb.put(0, 1);

	const dataBytes: number[] = [];
	for (let i = 0; i < bb.length; i += 8) {
		let byte = 0;
		for (let j = 0; j < 8; j++) byte = (byte << 1) | bb.bits[i + j];
		dataBytes.push(byte);
	}
	const PAD = [0xec, 0x11];
	let padIndex = 0;
	while (dataBytes.length < totalData) dataBytes.push(PAD[padIndex++ % 2]);

	/* split into blocks, compute ECC */
	const blocks: Uint8Array[] = [];
	const eccs: Uint8Array[] = [];
	let offset = 0;
	for (let i = 0; i < g1; i++) {
		const chunk = Uint8Array.from(dataBytes.slice(offset, offset + g1d));
		offset += g1d;
		blocks.push(chunk);
		eccs.push(rsEncode(chunk, ecLen));
	}
	for (let i = 0; i < g2; i++) {
		const chunk = Uint8Array.from(dataBytes.slice(offset, offset + g2d));
		offset += g2d;
		blocks.push(chunk);
		eccs.push(rsEncode(chunk, ecLen));
	}

	/* interleave */
	const finalBytes: number[] = [];
	const maxData = Math.max(g1d, g2d);
	for (let i = 0; i < maxData; i++) {
		for (const block of blocks) if (i < block.length) finalBytes.push(block[i]);
	}
	for (let i = 0; i < ecLen; i++) {
		for (const ecc of eccs) finalBytes.push(ecc[i]);
	}

	const bits: number[] = [];
	for (const byte of finalBytes) {
		for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
	}

	/* try all masks, keep the lowest penalty */
	let best: Grid | null = null;
	let bestScore = Infinity;
	for (let mask = 0; mask < 8; mask++) {
		const candidate = buildMatrix(version, bits, mask);
		const score = penalty(candidate);
		if (score < bestScore) {
			bestScore = score;
			best = candidate;
		}
	}

	return best!.map((row) => Array.from(row, (v) => v === 1));
}
