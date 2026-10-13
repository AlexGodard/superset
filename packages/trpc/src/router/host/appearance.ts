import {
	HOST_COLOR_PATTERN,
	HOST_ICONS,
} from "@superset/shared/host-appearance";
import { z } from "zod";

/** Omit a field to keep it; null resets it to the default. */
export const setHostAppearanceInput = z
	.object({
		hostId: z.string().min(1),
		icon: z.enum(HOST_ICONS).nullable().optional(),
		color: z.string().regex(HOST_COLOR_PATTERN).nullable().optional(),
	})
	.refine((input) => input.icon !== undefined || input.color !== undefined, {
		message: "Nothing to change",
	});
