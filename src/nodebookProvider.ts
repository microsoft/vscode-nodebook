/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Project, ProjectContainer } from './project';
import { NotebookDocumentEditEvent } from 'vscode';

interface RawNotebookCell {
	language: string;
	value: string;
	kind: vscode.CellKind;
	editable?: boolean;
}

export class NodebookContentProvider implements vscode.NotebookContentProvider {

	private _localDisposables: vscode.Disposable[];
	private readonly container: ProjectContainer

	constructor(container: ProjectContainer) {
		this.container = container;
		this._localDisposables = [];

		this._localDisposables.push(vscode.notebook.onDidOpenNotebookDocument(document => {

			if (this.container.lookupProject(document.uri, false)) {
				return;
			}

			// (1) register a new project for this notebook
			// todo@API add new cells

			const project = new Project();
			this.container.register(
				document.uri,
				project,
				uri => document.cells.some(cell => cell.uri.toString() === uri.toString()),
			);
		}));

		this._localDisposables.push(vscode.notebook.onDidCloseNotebookDocument(() => {
			// todo unregister
		}));
	}

	onDidChangeNotebook: vscode.Event<NotebookDocumentEditEvent> = new vscode.EventEmitter<NotebookDocumentEditEvent>().event;

	async openNotebook(uri: vscode.Uri): Promise<vscode.NotebookData> {

		let contents = '';
		try {
			contents = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
		} catch {
		}

		let raw: RawNotebookCell[];
		try {
			raw = <RawNotebookCell[]>JSON.parse(contents);
		} catch {
			raw = [];
		}

		const notebookData: vscode.NotebookData = {
			languages: ['javascript'],
			metadata: { cellRunnable: true },
			cells: raw.map(item => ({
				source: item.value,
				language: item.language,
				cellKind: item.kind,
				outputs: [],
				metadata: { editable: item.editable ?? true, runnable: true }
			}))
		};

		return notebookData;
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

	public saveNotebook(document: vscode.NotebookDocument, _cancellation: vscode.CancellationToken): Promise<void> {
		return this._save(document, document.uri);
	}

	public saveNotebookAs(targetResource: vscode.Uri, document: vscode.NotebookDocument, _cancellation: vscode.CancellationToken): Promise<void> {
		return this._save(document, targetResource);
	}

	public dispose() {
		this._localDisposables.forEach(d => d.dispose());
	}

	// ---- private ----

	private async _save(document: vscode.NotebookDocument, targetResource: vscode.Uri): Promise<void> {
		let contents: RawNotebookCell[] = [];
		for (let cell of document.cells) {
			contents.push({
				kind: cell.cellKind,
				language: cell.language,
				value: cell.document.getText(),
				editable: cell.metadata.editable
			});
		}
		await vscode.workspace.fs.writeFile(targetResource, Buffer.from(JSON.stringify(contents)));
	}
}
