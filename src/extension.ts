/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vsc from 'vscode';
import { NodebookContentProvider } from './nodebookProvider';

const nodebookContentProvider = new NodebookContentProvider();

type Command = 'nodebook.toggleDebugging' | 'nodebook.restartKernel';

const registerCommand = (cmd: Command) => vsc.commands.registerCommand(cmd, () => {
	if (!vsc.window.activeNotebookEditor) return;
	const { document } = vsc.window.activeNotebookEditor;
	const project = nodebookContentProvider.lookupProject(document.uri);
	if (!project) return;

	switch (cmd) {
		case "nodebook.restartKernel":
			return project.restart_kernel_cmd()
		case "nodebook.toggleDebugging":
			return project.toggle_debugging_cmd(document)
	}
});

export function activate(context: vsc.ExtensionContext) {
	context.subscriptions.push(
		vsc.notebook.registerNotebookContentProvider('nodebook', nodebookContentProvider),
		registerCommand("nodebook.restartKernel"),
		registerCommand("nodebook.toggleDebugging"),
	);
}

export function deactivate() {
	nodebookContentProvider.dispose();
}
