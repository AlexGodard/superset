import { expect, test } from "bun:test";
import { setHostAppearanceInput } from "./appearance";

test("accepts a known icon and a hex color", () => {
	expect(
		setHostAppearanceInput.safeParse({
			hostId: "host",
			icon: "server",
			color: "#3b82f6",
		}).success,
	).toBe(true);
});

test("null resets a field", () => {
	expect(
		setHostAppearanceInput.safeParse({ hostId: "host", icon: null }).success,
	).toBe(true);
});

test("rejects an unknown icon or a color that is not #rrggbb", () => {
	expect(
		setHostAppearanceInput.safeParse({ hostId: "host", icon: "rocket" })
			.success,
	).toBe(false);
	expect(
		setHostAppearanceInput.safeParse({ hostId: "host", color: "blue" }).success,
	).toBe(false);
});

test("rejects a call that changes nothing", () => {
	expect(setHostAppearanceInput.safeParse({ hostId: "host" }).success).toBe(
		false,
	);
});
