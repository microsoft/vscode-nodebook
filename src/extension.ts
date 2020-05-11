/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { ProjectContainer } from './project';
import { NodebookContentProvider } from './nodebookProvider';

export function activate(context: vscode.ExtensionContext) {

	const projectContainer = new ProjectContainer();

	context.subscriptions.push(vscode.notebook.registerNotebookContentProvider('nodebook', new NodebookContentProvider(projectContainer)));

	context.subscriptions.push(vscode.commands.registerCommand('nodebook.toggleDebugging', () => {
		if (vscode.notebook.activeNotebookEditor) {
			const { document } = vscode.notebook.activeNotebookEditor;
			const project = projectContainer.lookupProject(document.uri);
			project.toggleDebugging(document);
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('nodebook.restartKernel', () => {
		if (vscode.notebook.activeNotebookEditor) {
			const { document } = vscode.notebook.activeNotebookEditor;
			const project = projectContainer.lookupProject(document.uri);
			project.restartKernel();
		}
	}));

	/*
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('node', {
		provideDebugConfigurations(_folder: vscode.WorkspaceFolder) {
			return [
				{
					name: 'Debug Nodebook',
					type: 'node',
					request: 'attach',
					port: 12345
				}
			];
		}
	}, vscode.DebugConfigurationProviderTriggerKind.Dynamic));
	*/
}

export function deactivate() {
}
