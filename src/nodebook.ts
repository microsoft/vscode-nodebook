/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { NodeKernel } from './nodeKernel';

export class Nodebook implements vscode.Disposable {

	private nodeKernel: NodeKernel;
	private debugging = false;
	private disposables: vscode.Disposable[] = [];
	private activeDebugSession: vscode.DebugSession | undefined;

	constructor(doc: vscode.NotebookDocument) {
		this.nodeKernel = new NodeKernel(doc);
	}

	async dispose() {
		await this.stopDebugger();
		this.nodeKernel.stop();
	}

	public async restartKernel() {
		await this.stopDebugger();
		await vscode.commands.executeCommand('notebook.clearAllCellsOutputs');
		await this.nodeKernel.restart();
		if (this.debugging) {
			await this.startDebugger();
		}
	}

	public async toggleDebugging(document: vscode.NotebookDocument) {

		if (this.debugging) {
			this.stopDebugger();
		}

		this.debugging = !this.debugging;

		for (let cell of document.cells) {
			if (cell.cellKind === vscode.CellKind.Code) {
				cell.metadata.breakpointMargin = this.debugging;
			}
		}
	}

	public async eval(cell: vscode.NotebookCell): Promise<string> {
		await this.nodeKernel.start();
		if (this.debugging) {
			await this.startDebugger();
		}
		return this.nodeKernel.eval(cell);
	}

	public addDebugSession(session: vscode.DebugSession) {
		if (this.activeDebugSession) {
			console.log(`error: there is already a debug session`);
			return;
		}
		this.activeDebugSession = session;
	}

	public removeDebugSession(session: vscode.DebugSession) {
		if (this.activeDebugSession !== session) {
			console.log(`error: removed session doesn't match active session`);
			return;
		}
		this.activeDebugSession = undefined;
	}

	public createTracker(): vscode.DebugAdapterTracker {
		return this.nodeKernel.createTracker();
	}

	private async startDebugger() {
		if (!this.activeDebugSession) {
			try {
				await vscode.debug.startDebugging(undefined, this.nodeKernel.getLaunchConfig());
			} catch(err) {
				console.log(`error: ${err}`);
			}
		}
	}

	private async stopDebugger() {
		if (this.activeDebugSession) {
			await vscode.commands.executeCommand('workbench.action.debug.stop');
			this.disposables.forEach(d => d.dispose());
			this.disposables = [];
		}
	}
}
