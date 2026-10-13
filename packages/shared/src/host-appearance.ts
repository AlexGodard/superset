/** Each client maps these names to its own glyph; any other value shows the default. */
export const HOST_ICONS = [
	"laptop",
	"monitor",
	"server",
	"cloud",
	"cpu",
	"terminal",
	"house",
	"briefcase",
	"gamepad",
	"flask",
] as const;

export type HostIcon = (typeof HOST_ICONS)[number];

export const HOST_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export function isHostIcon(
	value: string | null | undefined,
): value is HostIcon {
	return HOST_ICONS.includes(value as HostIcon);
}
