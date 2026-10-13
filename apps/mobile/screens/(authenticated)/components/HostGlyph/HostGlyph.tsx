import { type HostIcon, isHostIcon } from "@superset/shared/host-appearance";
import {
	Briefcase,
	Cloud,
	Cpu,
	FlaskConical,
	Gamepad2,
	House,
	Laptop,
	type LucideIcon,
	Monitor,
	Server,
	Terminal,
} from "lucide-react-native";
import { View } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { HostStatusDot } from "../HostStatusDot";

const HOST_ICON_COMPONENTS: Record<HostIcon, LucideIcon> = {
	laptop: Laptop,
	monitor: Monitor,
	server: Server,
	cloud: Cloud,
	cpu: Cpu,
	terminal: Terminal,
	house: House,
	briefcase: Briefcase,
	gamepad: Gamepad2,
	flask: FlaskConical,
};

interface HostGlyphProps {
	icon: string | null | undefined;
	color: string | null | undefined;
	isOnline: boolean;
	size?: number;
}

/** A host with no icon and no color shows only its status dot. */
export function HostGlyph({
	icon,
	color,
	isOnline,
	size = 16,
}: HostGlyphProps) {
	const theme = useTheme();
	const known = isHostIcon(icon);
	if (!known && !color) return <HostStatusDot isOnline={isOnline} />;

	const Glyph = known ? HOST_ICON_COMPONENTS[icon] : Server;
	return (
		<View style={{ width: size, height: size }}>
			<Glyph
				size={size}
				color={color ?? theme.mutedForeground}
				strokeWidth={2}
			/>
			<View
				className="bg-background absolute rounded-full p-[1.5px]"
				style={{ right: -3, bottom: -3 }}
			>
				<HostStatusDot isOnline={isOnline} />
			</View>
		</View>
	);
}
