import { Trans, useLingui } from "@lingui/react/macro";
import { ENTITY_COLORS } from "@superset/shared/entity-colors";
import { HOST_ICONS, type HostIcon } from "@superset/shared/host-appearance";
import { Popover, PopoverContent, PopoverTrigger } from "@superset/ui/popover";
import { cn } from "@superset/ui/utils";
import type { IconType } from "react-icons";
import {
	HOST_ICON_COMPONENTS,
	HOST_ICON_LABELS,
	HostIcon as HostIconGlyph,
} from "renderer/components/HostIcon";

const COLOR_OPTIONS: (string | null)[] = [null, ...ENTITY_COLORS];

interface HostAppearancePickerProps {
	icon: string | null;
	color: string | null;
	fallback: IconType;
	disabled: boolean;
	onChange: (change: { icon?: HostIcon | null; color?: string | null }) => void;
}

export function HostAppearancePicker({
	icon,
	color,
	fallback,
	disabled,
	onChange,
}: HostAppearancePickerProps) {
	const { t } = useLingui();
	const glyph = (
		<HostIconGlyph
			icon={icon}
			color={color}
			fallback={fallback}
			className={cn("size-5", !color && "text-muted-foreground")}
		/>
	);

	if (disabled) {
		return (
			<span className="flex size-8 items-center justify-center">{glyph}</span>
		);
	}

	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={t({ message: "Change host icon and color" })}
					className="flex size-8 items-center justify-center rounded-md hover:bg-fill-hover"
				>
					{glyph}
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-auto p-2">
				<div className="flex items-center justify-between px-1 pb-1.5">
					<span className="text-xs font-medium text-muted-foreground">
						<Trans>Icon</Trans>
					</span>
					{icon && (
						<button
							type="button"
							onClick={() => onChange({ icon: null })}
							className="rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-fill-hover hover:text-foreground"
						>
							<Trans>Reset</Trans>
						</button>
					)}
				</div>
				<div className="grid grid-cols-5 gap-1">
					{HOST_ICONS.map((name) => {
						const Icon = HOST_ICON_COMPONENTS[name];
						return (
							<button
								key={name}
								type="button"
								aria-label={t(HOST_ICON_LABELS[name])}
								aria-pressed={name === icon}
								onClick={() => onChange({ icon: name })}
								className={cn(
									"flex size-8 items-center justify-center rounded-md hover:bg-fill-hover",
									name === icon && "bg-fill-selected",
								)}
							>
								<Icon
									className={cn("size-4", !color && "text-muted-foreground")}
									style={color ? { color } : undefined}
								/>
							</button>
						);
					})}
				</div>
				<div className="px-1 pt-3 pb-1.5 text-xs font-medium text-muted-foreground">
					<Trans>Color</Trans>
				</div>
				<div className="grid grid-cols-5 gap-1">
					{COLOR_OPTIONS.map((option) => (
						<button
							key={option ?? "none"}
							type="button"
							aria-label={option ?? t({ message: "No color" })}
							aria-pressed={option === color}
							onClick={() => onChange({ color: option })}
							className={cn(
								"flex size-8 items-center justify-center rounded-md hover:bg-fill-hover",
								option === color && "bg-fill-selected",
							)}
						>
							<span
								className={cn(
									"size-4 rounded-full",
									!option && "bg-muted-foreground/60",
								)}
								style={option ? { backgroundColor: option } : undefined}
							/>
						</button>
					))}
				</div>
			</PopoverContent>
		</Popover>
	);
}
