/**
 * Upstream shows the Mobile pane to accounts with PostHog's `mobile-pane` flag.
 * This self-built fork shows it whatever the flag says.
 */
export function mobilePaneEnabled(_flagEnabled: boolean | undefined): boolean {
	return true;
}
