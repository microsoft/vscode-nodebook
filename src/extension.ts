/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { NodebookContentProvider } from './nodebookProvider';

export function activate(context: vscode.ExtensionContext) {

	const nodebookContentProvider = new NodebookContentProvider();

	context.subscriptions.push(

		vscode.notebook.registerNotebookContentProvider('nodebook', nodebookContentProvider),

		vscode.commands.registerCommand('nodebook.toggleDebugging', () => {
			if (vscode.window.activeNotebookEditor) {
				const { document } = vscode.window.activeNotebookEditor;
				const nodebook = nodebookContentProvider.lookupNodebook(document.uri);
				if (nodebook) {
					nodebook.toggleDebugging(document);
				}
			}
		}),

		vscode.commands.registerCommand('nodebook.restartKernel', () => {
			if (vscode.window.activeNotebookEditor) {
				const { document } = vscode.window.activeNotebookEditor;
				const nodebook = nodebookContentProvider.lookupNodebook(document.uri);
				if (nodebook) {
					nodebook.restartKernel();
				}
			}
		})
	);
}

export function deactivate() {
}
