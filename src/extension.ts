/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { ProjectContainer } from './project';
import { NodebookContentProvider } from './nodebookProvider';
import { NotebookKernel } from './nodebookKernel';

export function activate(context: vscode.ExtensionContext) {

	const projectContainer = new ProjectContainer();

	context.subscriptions.push(

		vscode.notebook.registerNotebookContentProvider('nodebook', new NodebookContentProvider(projectContainer)),

		vscode.notebook.registerNotebookKernel('nodebook-kernel', ['*'], new NotebookKernel(projectContainer))
	);

	context.subscriptions.push(

		vscode.commands.registerCommand('nodebook.toggleDebugging', () => {
			if (vscode.notebook.activeNotebookEditor) {
				const { document } = vscode.notebook.activeNotebookEditor;
				const project = projectContainer.lookupProject(document.uri);
				if (project) {
					project.toggleDebugging(document);
				}
			}
		}),

		vscode.commands.registerCommand('nodebook.restartKernel', () => {
			if (vscode.notebook.activeNotebookEditor) {
				const { document } = vscode.notebook.activeNotebookEditor;
				const project = projectContainer.lookupProject(document.uri);
				if (project) {
					project.restartKernel();
				}
			}
		})
	);
}

export function deactivate() {
}
