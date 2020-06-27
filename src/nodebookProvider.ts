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

	private _localDisposables: vscode.Disposable[] = [];

 	kernel?: vscode.NotebookKernel;

	constructor(private readonly container: ProjectContainer, kernel: vscode.NotebookKernel) {

		this.kernel = kernel;

		// hook global event handlers here once

		this._localDisposables.push(vscode.notebook.onDidOpenNotebookDocument(document => {

			const docKey = document.uri.toString();
			if (!this.container.lookupProject(docKey)) {
				// (1) register a new project for this notebook

				const project = new Project(document);
				this.container.register(
					docKey,
					project,
					key => document.cells.some(cell => cell.uri.toString() === key) || (key === docKey),
				);
			}
		}));

		this._localDisposables.push(vscode.notebook.onDidCloseNotebookDocument(document => {
			const project = this.container.unregister(document.uri.toString());
			if (project) {
				project.dispose();
			}
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
				metadata: {
					editable: true,
					runnable: true,
					breakpointMargin: false
				 }
			}))
		};

		return notebookData;
	}

	public saveNotebook(document: vscode.NotebookDocument, _cancellation: vscode.CancellationToken): Promise<void> {
		return this._save(document, document.uri);
	}

	public saveNotebookAs(targetResource: vscode.Uri, document: vscode.NotebookDocument, _cancellation: vscode.CancellationToken): Promise<void> {
		return this._save(document, targetResource);
	}

	async resolveNotebook(_document: vscode.NotebookDocument, _webview: vscode.NotebookCommunication): Promise<void> {
		// nothing
	}

	async backupNotebook(document: vscode.NotebookDocument, context: vscode.NotebookDocumentBackupContext, _cancellation: vscode.CancellationToken): Promise<vscode.NotebookDocumentBackup> {
		await this._save(document, context.destination);
		return {
			id: context.destination.toString(),
			delete: () => vscode.workspace.fs.delete(context.destination)
		};
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
			});
		}
		await vscode.workspace.fs.writeFile(targetResource, Buffer.from(JSON.stringify(contents)));
	}
}
