import { WorkspaceClientProvider } from "@superset/workspace-client";
import type { ReactNode } from "react";
import {
	getHostServiceHeaders,
	getHostServiceWsToken,
} from "renderer/lib/host-service-auth";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";

interface ThisMachineHostProps {
	children: ReactNode;
}

/**
 * Sends its children's host-service calls to the machine the app runs on
 * instead of the workspace's host. Until this machine's host service is up,
 * the children keep the workspace's.
 */
export function ThisMachineHost({ children }: ThisMachineHostProps) {
	const { activeHostUrl } = useLocalHostService();
	if (!activeHostUrl) return children;
	return (
		<WorkspaceClientProvider
			cacheKey="mobile-pane-this-machine"
			key={activeHostUrl}
			hostUrl={activeHostUrl}
			headers={() => getHostServiceHeaders(activeHostUrl)}
			wsToken={() => getHostServiceWsToken(activeHostUrl)}
		>
			{children}
		</WorkspaceClientProvider>
	);
}
