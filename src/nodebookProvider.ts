/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vsc from 'vscode';
import { Project } from './project';
import { NotebookDocumentEditEvent } from 'vscode';

interface RawNotebookCell {
	language: string;
	value: string;
	kind: vsc.CellKind;
	editable?: boolean;
}
/** ```ts
 * // Similer like,
 * type ProjectAssociation = (key: string) => boolean
 * ``` */
interface ProjectAssociation {
	(key: string): boolean;
}

const DEBUG_TYPES = ['node', 'node2', 'pwa-node', 'pwa-chrome'] as const;

export class NodebookContentProvider implements vsc.NotebookContentProvider, vsc.NotebookKernel {
	//------ Implementing NotebookKernel Props --------
	readonly id = 'nodebookKernel';
	readonly label = 'Node.js Kernel';
	//-------------------------------------------------

	private _localDisposables: vsc.Disposable[] = [];
	private readonly _associations = new Map<string, [ProjectAssociation, Project]>();

	onDidChangeNotebook: vsc.Event<NotebookDocumentEditEvent> = new vsc.EventEmitter<NotebookDocumentEditEvent>().event;

	constructor() {
		this._localDisposables.push(
			vsc.notebook.onDidOpenNotebookDocument(document => {
				const docKey = document.uri.toString();
				if (this.lookupProject(docKey)) return;

				const project = new Project(document);

				this._register(docKey, project, key => key === docKey);
			}),

			vsc.notebook.onDidCloseNotebookDocument(document => {
				const project = this._unregister(document.uri.toString());
				if (!project) return

				project.dispose();
			}),

			vsc.debug.onDidStartDebugSession(session => { this._internal(session, "addDebugSession") }),

			vsc.debug.onDidTerminateDebugSession(session => { this._internal(session, "removeDebugSession") }),
			// hook Source path conversion
			...DEBUG_TYPES.map(dt => vsc.debug.registerDebugAdapterTrackerFactory(dt, {
				createDebugAdapterTracker: (session: vsc.DebugSession) => this._internal(session, "createTracker"),
			})),
		);

		vsc.notebook.registerNotebookKernelProvider({ viewType: 'nodebook', }, { provideKernels: () => [this] });

	}

	lookupProject(keyOrUri: string | vsc.Uri | undefined): Project | undefined {
		if (!keyOrUri) return;
		const key = typeof keyOrUri == 'string' ? keyOrUri : keyOrUri.toString();

		for (const [association, value] of this._associations.values())
			if (association(key))
				return value;
	}

	dispose() {
		this._localDisposables.forEach(d => d.dispose());
	}

	// ========================= implemention vsc.NotebookContentProvider, vsc.NotebookKernel =========================

	async openNotebook(uri: vsc.Uri): Promise<vsc.NotebookData> {
		try {
			var raw = JSON.parse(Buffer.from(await vsc.workspace.fs.readFile(uri)).toString('utf8')) as RawNotebookCell[];
		} catch {
			raw = [];
		}
		return {
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
		}
	}

	saveNotebook(document: vsc.NotebookDocument, _cancellation: vsc.CancellationToken): Promise<void> {
		return this._save(document, document.uri);
	}

	saveNotebookAs(targetResource: vsc.Uri, document: vsc.NotebookDocument, _cancellation: vsc.CancellationToken): Promise<void> {
		return this._save(document, targetResource);
	}

	async backupNotebook(document: vsc.NotebookDocument, context: vsc.NotebookDocumentBackupContext, _cancellation: vsc.CancellationToken): Promise<vsc.NotebookDocumentBackup> {
		await this._save(document, context.destination);
		return {
			id: context.destination.toString(),
			delete: () => vsc.workspace.fs.delete(context.destination)
		};
	}

	async executeCell(_document: vsc.NotebookDocument, cell: vsc.NotebookCell): Promise<void> {
		let cellOutput!: vsc.CellOutput[];
		try {
			const project = this.lookupProject(cell.uri);
			cellOutput = [{
				outputKind: vsc.CellOutputKind.Text,
				text: project ? await project.eval(cell) : ''
			}]
		}
		catch (error) {
			cellOutput = [{
				outputKind: vsc.CellOutputKind.Error,
				evalue: error.toString(),
				ename: '',
				traceback: []
			}];
		}
		cell.outputs = cellOutput;
	}

	async executeAllCells(document: vsc.NotebookDocument): Promise<void> {
		for (const cell of document.cells) {
			await this.executeCell(document, cell);
		}
	}

	/** Todo: Do something. */
	async resolveNotebook(_document: vsc.NotebookDocument, _webview: vsc.NotebookCommunication): Promise<void> { }
	/** @ignore not yet supported */
	cancelCellExecution(_document: vsc.NotebookDocument, _cell: vsc.NotebookCell): void { }
	/** @ignore not yet supported */
	cancelAllCellsExecution(_document: vsc.NotebookDocument): void { }

	// =============================== private ===============================

	private _internal(session: vsc.DebugSession, type: 'createTracker' | 'removeDebugSession' | 'addDebugSession'): any {
		if (!session.configuration.__notebookID) return;
		const project = this.lookupProject(session.configuration.__notebookID);
		if (!project) return;	// no tracker
		switch (type) {
			case "createTracker": return project.createTracker();
			case "removeDebugSession": return project.removeDebugSession(session);
			case "addDebugSession": return project.addDebugSession(session);
		}
	}

	private async _save(document: vsc.NotebookDocument, targetResource: vsc.Uri): Promise<void> {
		let contents: RawNotebookCell[] = [];
		for (let cell of document.cells) {
			contents.push({
				kind: cell.cellKind,
				language: cell.language,
				value: cell.document.getText(),
			});
		}
		await vsc.workspace.fs.writeFile(targetResource, Buffer.from(JSON.stringify(contents)));
	}

	private _register(key: string, project: Project, association: ProjectAssociation) {
		this._associations.set(key, [association, project]);
	}

	private _unregister(key: string): Project | undefined {
		const project = this.lookupProject(key);
		if (project) {
			this._associations.delete(key);
		}
		return project;
	}
}
