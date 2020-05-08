/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Project, ProjectContainer } from './project';

interface RawNotebookCell {
	language: string;
	value: string;
	kind: vscode.CellKind;
	editable?: boolean;
}

export class NodebookProvider implements vscode.NotebookProvider {

	constructor(
		readonly container: ProjectContainer
	) { }

	async resolveNotebook(editor: vscode.NotebookEditor): Promise<void> {

		editor.document.languages = ['javascript'];

		let contents = '';
		try {
			contents = Buffer.from(await vscode.workspace.fs.readFile(editor.document.uri)).toString('utf8');
		} catch {
		}

		let raw: RawNotebookCell[];
		try {
			raw = <RawNotebookCell[]>JSON.parse(contents);
		} catch {
			raw = [];
		}
		await editor.edit(editBuilder => {
			for (let item of raw) {
				editBuilder.insert(
					0,
					item.value,
					item.language,
					item.kind,
					[],
					{ editable: item.editable ?? true, runnable: true }
				);
			}
		});

		const project = new Project(editor.document);
		this.container.register(
			editor.document.uri,
			project,
			(uri: vscode.Uri) => editor.document.cells.some(cell => cell.uri.toString() === uri.toString())
		);
	}

	async executeCell(document: vscode.NotebookDocument, cell: vscode.NotebookCell | undefined, token: vscode.CancellationToken): Promise<void> {

		if (!cell) {

			const project = this.container.lookupProject(document.uri);
			if (project) {
				project.stop();
			}

			// run them all
			for (let cell of document.cells) {
				if (cell.cellKind === vscode.CellKind.Code && cell.metadata.runnable) {
					await this.executeCell(document, cell, token);
				}
			}
			return;
		}

		let output = '';
		const project = this.container.lookupProject(cell.uri);
		if (project) {
			const data = cell.document.getText();
			output = await project.eval(cell.uri, data);
		}

		cell.outputs = [{
			outputKind: vscode.CellOutputKind.Text,
			text: output
		}];
	}

	async save(document: vscode.NotebookDocument): Promise<boolean> {
		let contents: RawNotebookCell[] = [];
		for (let cell of document.cells) {
			contents.push({
				kind: cell.cellKind,
				language: cell.language,
				value: cell.document.getText(),
				editable: cell.metadata.editable
			});
		}
		await vscode.workspace.fs.writeFile(document.uri, Buffer.from(JSON.stringify(contents)));
		return true;
	}
}
