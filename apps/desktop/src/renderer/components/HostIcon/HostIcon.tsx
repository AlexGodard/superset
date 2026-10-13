import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import {
	type HostIcon as HostIconName,
	isHostIcon,
} from "@superset/shared/host-appearance";
import type { IconType } from "react-icons";
import {
	LuBriefcase,
	LuCloud,
	LuCpu,
	LuFlaskConical,
	LuGamepad2,
	LuHouse,
	LuLaptop,
	LuMonitor,
	LuServer,
	LuTerminal,
} from "react-icons/lu";

export const HOST_ICON_COMPONENTS: Record<HostIconName, IconType> = {
	laptop: LuLaptop,
	monitor: LuMonitor,
	server: LuServer,
	cloud: LuCloud,
	cpu: LuCpu,
	terminal: LuTerminal,
	house: LuHouse,
	briefcase: LuBriefcase,
	gamepad: LuGamepad2,
	flask: LuFlaskConical,
};

export const HOST_ICON_LABELS: Record<HostIconName, MessageDescriptor> = {
	laptop: msg({ message: "Laptop", context: "host icon" }),
	monitor: msg({ message: "Desktop", context: "host icon" }),
	server: msg({ message: "Server", context: "host icon" }),
	cloud: msg({ message: "Cloud", context: "host icon" }),
	cpu: msg({ message: "Chip", context: "host icon" }),
	terminal: msg({ message: "Terminal", context: "host icon" }),
	house: msg({ message: "Home", context: "host icon" }),
	briefcase: msg({ message: "Work", context: "host icon" }),
	gamepad: msg({ message: "Gaming", context: "host icon" }),
	flask: msg({ message: "Lab", context: "host icon" }),
};

interface HostIconProps {
	icon: string | null | undefined;
	color: string | null | undefined;
	/** Shown when the host has no icon, or one this build doesn't know. */
	fallback: IconType;
	className?: string;
	strokeWidth?: number;
}

export function HostIcon({
	icon,
	color,
	fallback: Fallback,
	className,
	strokeWidth,
}: HostIconProps) {
	const Icon = isHostIcon(icon) ? HOST_ICON_COMPONENTS[icon] : Fallback;
	return (
		<Icon
			className={className}
			strokeWidth={strokeWidth}
			style={color ? { color } : undefined}
		/>
	);
}
