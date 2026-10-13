import { useLingui } from "@lingui/react/macro";
import { formatRelativeTime } from "@superset/i18n/format";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { HostStatusDot } from "@/screens/(authenticated)/components/HostStatusDot";
import { getLastSeenTime } from "../../utils/getLastSeenTime";

export type HostSectionState =
	| "offline"
	| "loading"
	| "error"
	| "empty"
	| "ready";

interface HostSectionHeaderProps {
	name: string;
	isOnline: boolean;
	/** Null = never reached the relay; absent = presence unavailable. */
	lastSeenAt: number | null | undefined;
	state: HostSectionState;
	isFirst: boolean;
}

export function HostSectionHeader({
	name,
	isOnline,
	lastSeenAt,
	state,
	isFirst,
}: HostSectionHeaderProps) {
	const { t } = useLingui();

	let note: string | null = null;
	if (state === "offline") {
		if (lastSeenAt === null) {
			note = t({ message: "Not connected" });
		} else if (lastSeenAt === undefined) {
			note = t({ message: "Offline" });
		} else {
			const now = Date.now();
			const lastSeen = formatRelativeTime(
				getLastSeenTime(lastSeenAt, now),
				now,
			);
			note = t({ message: `Last seen ${lastSeen}` });
		}
	} else if (state === "error") {
		note = t({ message: "Couldn't load workspaces" });
	} else if (state === "empty") {
		note = t({ message: "No workspaces" });
	}

	return (
		<View
			accessibilityRole="header"
			className={cn(
				"flex-row items-center gap-2 px-4 pb-1",
				isFirst ? "pt-2" : "pt-8",
			)}
		>
			<HostStatusDot isOnline={isOnline} />
			<Text
				className="text-muted-foreground shrink font-medium text-[14px]"
				numberOfLines={1}
			>
				{name}
			</Text>
			{note ? (
				<Text
					className="text-muted-foreground/70 shrink text-[13px]"
					numberOfLines={1}
				>
					{note}
				</Text>
			) : null}
		</View>
	);
}
