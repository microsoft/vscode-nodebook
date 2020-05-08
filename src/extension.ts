/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { ProjectContainer } from './project';
import { NodebookProvider } from './nodebookProvider';

export function activate(context: vscode.ExtensionContext) {

	const projectContainer = new ProjectContainer();

	context.subscriptions.push(vscode.notebook.registerNotebookProvider('nodebook', new NodebookProvider(projectContainer)));
}

export function deactivate() {
}
