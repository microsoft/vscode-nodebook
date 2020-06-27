/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as vscode from 'vscode';
import { ProjectContainer } from './project';

const debugTypes = ['node', 'node2', 'pwa-node', 'pwa-chrome'];


export class NotebookKernel implements vscode.NotebookKernel {

	public label = 'Node.js Kernel';

	private _localDisposables: vscode.Disposable[] = [];

	constructor(private readonly container: ProjectContainer) {

		this._localDisposables.push(

			vscode.debug.onDidStartDebugSession(session => {
				if (session.configuration.__notebookID) {
					const project = this.container.lookupProject(session.configuration.__notebookID);
					if (project) {
						project.addDebugSession(session);
					}
				}
			}),

			vscode.debug.onDidTerminateDebugSession(session => {
				if (session.configuration.__notebookID) {
					const project = this.container.lookupProject(session.configuration.__notebookID);
					if (project) {
						project.removeDebugSession(session);
					}
				}
			}),

			// hook Source path conversion
			...debugTypes.map(dt => vscode.debug.registerDebugAdapterTrackerFactory(dt, {
				createDebugAdapterTracker: (session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterTracker> => {
					if (session.configuration.__notebookID) {
						const project = this.container.lookupProject(session.configuration.__notebookID);
						if (project) {
							return project.createTracker();
						}
					}
					return undefined;	// no tracker
				}
			}))
		);
	}

	/**
	 * @inheritdoc
	 */
	public async executeCell(document: vscode.NotebookDocument, cell: vscode.NotebookCell, token: vscode.CancellationToken): Promise<void> {

		if (!cell) {

			const project = this.container.lookupProject(document.uri);
			if (project) {
				project.restartKernel();
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

	/**
	 * @inheritdoc
	 */
	public async executeAllCells(document: vscode.NotebookDocument, token: vscode.CancellationToken): Promise<void> {

	  for (const cell of document.cells) {
		if (token.isCancellationRequested) {
		  break;
		}
		await this.executeCell(document, cell, token);
	  }
	}
}
