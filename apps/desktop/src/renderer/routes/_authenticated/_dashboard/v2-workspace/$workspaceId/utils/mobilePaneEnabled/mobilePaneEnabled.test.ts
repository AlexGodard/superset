import { expect, test } from "bun:test";
import { mobilePaneEnabled } from "./mobilePaneEnabled";

test("the fork shows the Mobile pane whatever the flag says", () => {
	expect(mobilePaneEnabled(undefined)).toBe(true);
	expect(mobilePaneEnabled(false)).toBe(true);
	expect(mobilePaneEnabled(true)).toBe(true);
});
