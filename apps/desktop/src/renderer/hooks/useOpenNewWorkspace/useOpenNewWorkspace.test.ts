import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import type { useNavigate } from "@tanstack/react-router";
import { useNewWorkspaceDraftStore } from "renderer/stores/new-workspace-draft";
import { useNewWorkspaceModalStore } from "renderer/stores/new-workspace-modal";
import { useV2WorkspaceCreateDefaultsStore } from "renderer/stores/v2-workspace-create-defaults";
import {
	openNewSession,
	openNewWorkspace,
	openNewWorkspaceForLocalProject,
} from "./useOpenNewWorkspace";

const navigate = mock(() => Promise.resolve());
const MACHINE_ID = "this-machine";
const v2 = {
	isV2CloudEnabled: true,
	machineId: MACHINE_ID,
	navigate: navigate as unknown as ReturnType<typeof useNavigate>,
};

function resetStores() {
	useNewWorkspaceDraftStore.getState().resetDraft();
	useV2WorkspaceCreateDefaultsStore.getState().setLastHostId(null);
	useV2WorkspaceCreateDefaultsStore.getState().setAutoHost(false);
	useNewWorkspaceModalStore.getState().closeModal();
}

beforeEach(() => {
	navigate.mockClear();
	resetStores();
});
afterEach(resetStores);

test("local project handoff pins this machine for that open and keeps the draft", () => {
	useNewWorkspaceDraftStore.getState().updateDraft({
		promptDraft: [{ type: "text", text: "Keep my prompt" }],
		checkout: "local",
	});
	openNewWorkspaceForLocalProject(v2, "new-project");
	expect(navigate).toHaveBeenCalledWith(
		expect.objectContaining({
			to: "/new-workspace",
			search: { projectId: "new-project", host: "this-machine" },
		}),
	);
	expect(useNewWorkspaceDraftStore.getState()).toMatchObject({
		selectedProjectId: "new-project",
		isSession: false,
		promptDraft: [{ type: "text", text: "Keep my prompt" }],
		checkout: "local",
	});
});

test("project handoff names no host, so the saved pick applies", () => {
	openNewWorkspace(v2, "project-a");
	expect(navigate).toHaveBeenCalledWith(
		expect.objectContaining({
			search: { projectId: "project-a", host: undefined },
		}),
	);
	expect(useNewWorkspaceDraftStore.getState().selectedProjectId).toBe(
		"project-a",
	);
});

test("a host the caller asks for goes in the URL", () => {
	openNewWorkspace(v2, "project-a", "cloud");
	expect(navigate).toHaveBeenCalledWith(
		expect.objectContaining({
			search: { projectId: "project-a", host: "cloud" },
		}),
	);
});

test("project handoff leaves the host to Auto when Auto picks hosts", () => {
	useV2WorkspaceCreateDefaultsStore.getState().setAutoHost(true);
	useV2WorkspaceCreateDefaultsStore.getState().setLastHostId("other-machine");
	openNewWorkspace(v2, "project-a");
	expect(navigate).toHaveBeenCalledWith(
		expect.objectContaining({ search: { projectId: "project-a" } }),
	);
});

// The hand-picked host is the saved one now, and the handoff names no host, so
// the screen reads it from the store as long as the draft still declines Auto.
test("project handoff keeps a host picked by hand over Auto", () => {
	useV2WorkspaceCreateDefaultsStore.getState().setAutoHost(true);
	useV2WorkspaceCreateDefaultsStore.getState().setLastHostId("other-machine");
	useNewWorkspaceDraftStore.setState({ autoHostDeclined: true });
	openNewWorkspace(v2, "project-a");
	expect(navigate).toHaveBeenCalledWith(
		expect.objectContaining({
			search: { projectId: "project-a", host: undefined },
		}),
	);
	expect(useNewWorkspaceDraftStore.getState().autoHostDeclined).toBe(true);
	expect(useV2WorkspaceCreateDefaultsStore.getState().lastHostId).toBe(
		"other-machine",
	);
});

test("a host picked by hand is that workspace's: the next draft starts on Auto", () => {
	useV2WorkspaceCreateDefaultsStore.getState().setLastHostId("other-machine");
	useNewWorkspaceDraftStore.setState({ autoHostDeclined: true });
	useNewWorkspaceDraftStore.getState().resetDraft();
	expect(useNewWorkspaceDraftStore.getState().autoHostDeclined).toBe(false);
	expect(useV2WorkspaceCreateDefaultsStore.getState().lastHostId).toBe(
		"other-machine",
	);
});

test("session handoff names no host and selects the session", () => {
	openNewSession(v2);
	expect(navigate).toHaveBeenCalledWith(
		expect.objectContaining({ search: { session: true } }),
	);
	expect(useNewWorkspaceDraftStore.getState().isSession).toBe(true);
});

test("session handoff re-selects the session when the URL already asks for it", () => {
	useNewWorkspaceDraftStore.getState().selectProject("project-a");
	openNewSession(v2);
	expect(useNewWorkspaceDraftStore.getState()).toMatchObject({
		isSession: true,
		selectedProjectId: null,
	});
});

test("v1 local project handoff still opens the project modal", () => {
	openNewWorkspaceForLocalProject(
		{ ...v2, isV2CloudEnabled: false },
		"v1-project",
	);
	expect(navigate).not.toHaveBeenCalled();
	expect(useNewWorkspaceModalStore.getState()).toMatchObject({
		isOpen: true,
		preSelectedProjectId: "v1-project",
	});
});

test("a handoff with a repository lets the pick follow it to another host", () => {
	openNewWorkspace(v2, "stand-in", undefined, "thinkfiveable/hours");
	expect(useNewWorkspaceDraftStore.getState()).toMatchObject({
		selectedProjectId: "stand-in",
		selectedProjectRepository: "thinkfiveable/hours",
	});
});
