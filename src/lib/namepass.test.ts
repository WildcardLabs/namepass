import { expect, it } from "vitest";
import { depositAddress } from "./namepass";
it("derives the independently verified deposit wallets for the new factory", () => {
 expect(depositAddress("steve")).toBe("0x5B7516768eD0b04E212041265BB1f11af71841d7");
 expect(depositAddress("vitalik")).toBe("0xa61656CA2D2952a46a9d4DA0AAE01d8D7fe988E0");
});
