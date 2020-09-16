/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Nodebook } from './nodebook';
import { NotebookDocumentEditEvent } from 'vscode';

interface RawNotebookCell {
	language: string;
	value: string;
	kind: vscode.CellKind;
	editable?: boolean;
}

interface ProjectAssociation {
	(key: string): boolean;
}

const debugTypes = ['node', 'node2', 'pwa-node', 'pwa-chrome'];

export class NodebookContentProvider implements vscode.NotebookContentProvider, vscode.NotebookKernel {

	readonly id = 'nodebookKernel';
	public label = 'Node.js Kernel';

	private _localDisposables: vscode.Disposable[] = [];
	private readonly _associations = new Map<string, [ProjectAssociation, Nodebook]>();


	onDidChangeNotebook: vscode.Event<NotebookDocumentEditEvent> = new vscode.EventEmitter<NotebookDocumentEditEvent>().event;

	constructor() {

		this._localDisposables.push(

			vscode.notebook.onDidOpenNotebookDocument(document => {
				const docKey = document.uri.toString();
				if (!this.lookupNodebook(docKey)) {
					const project = new Nodebook(document);
					this.register(
						docKey,
						project,
						key => document.cells.some(cell => cell.uri.toString() === key) || (key === docKey),
					);
				}
			}),

			vscode.notebook.onDidCloseNotebookDocument(document => {
				const project = this.unregister(document.uri.toString());
				if (project) {
					project.dispose();
				}
			}),

			vscode.debug.onDidStartDebugSession(session => {
				if (session.configuration.__notebookID) {
					const project = this.lookupNodebook(session.configuration.__notebookID);
					if (project) {
						project.addDebugSession(session);
					}
				}
			}),

			vscode.debug.onDidTerminateDebugSession(session => {
				if (session.configuration.__notebookID) {
					const project = this.lookupNodebook(session.configuration.__notebookID);
					if (project) {
						project.removeDebugSession(session);
					}
				}
			}),

			// hook Source path conversion
			...debugTypes.map(dt => vscode.debug.registerDebugAdapterTrackerFactory(dt, {
				createDebugAdapterTracker: (session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterTracker> => {
					if (session.configuration.__notebookID) {
						const notebook = this.lookupNodebook(session.configuration.__notebookID);
						if (notebook) {
							return notebook.createTracker();
						}
					}
					return undefined;	// no tracker
				}
			}))
		);

		vscode.notebook.registerNotebookKernelProvider({
			viewType: 'nodebook',
		}, {
			provideKernels: () => {
				return [this];
			}
		});
	}

	public lookupNodebook(keyOrUri: string | vscode.Uri | undefined): Nodebook | undefined {
		if (keyOrUri) {
			let key: string;
			if (typeof keyOrUri === 'string') {
				key = keyOrUri;
			} else {
				key = keyOrUri.toString();
			}
			for (let [association, value] of this._associations.values()) {
				if (association(key)) {
					return value;
				}
			}
		}
		return undefined;
	}

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



	public async executeCell(_document: vscode.NotebookDocument, cell: vscode.NotebookCell): Promise<void> {

		let output = '';
		let error: Error | undefined;
		const nodebook = this.lookupNodebook(cell.uri);
		if (nodebook) {
			try {
				output = await nodebook.eval(cell);
			} catch(e) {
				error = e;
			}
		}
		if (error) {
			cell.outputs = [{
				outputKind: vscode.CellOutputKind.Error,
				evalue: error.toString(),
				ename: '',
				traceback: []
			}];
		} else {
			cell.outputs = [{
				outputKind: vscode.CellOutputKind.Text,
				text: output
			}];
		}
	}

	public cancelCellExecution(_document: vscode.NotebookDocument, _cell: vscode.NotebookCell): void {
		// not yet supported
	}

	public async executeAllCells(document: vscode.NotebookDocument): Promise<void> {
	  for (const cell of document.cells) {
		await this.executeCell(document, cell);
	  }
	}

	cancelAllCellsExecution(_document: vscode.NotebookDocument): void {
		// not yet supported
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

	private register(key: string, project: Nodebook, association: ProjectAssociation) {
		this._associations.set(key, [association, project]);
	}

	private unregister(key: string): Nodebook | undefined {
		const project = this.lookupNodebook(key);
		if (project) {
			this._associations.delete(key);
		}
		return project;
	}
}
