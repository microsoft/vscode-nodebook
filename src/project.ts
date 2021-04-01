/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vsc from 'vscode';
import { NodeKernel } from './nodeKernel';

export class Project implements vsc.Disposable {

	private nodeKernel: NodeKernel;
	private debugging = false;
	private disposables: vsc.Disposable[] = [];
	private activeDebugSession: vsc.DebugSession | undefined;

	constructor(doc: vsc.NotebookDocument) {
		this.nodeKernel = new NodeKernel(doc);
	}

	async dispose() {
		await this.stopDebugger();
		this.nodeKernel.stop();
	}

	async restart_kernel_cmd() {
		await this.stopDebugger();
		await vsc.commands.executeCommand('notebook.clearAllCellsOutputs');
		await this.nodeKernel.restart();
		if (this.debugging) {
			await this.startDebugger();
		}
	}

	async toggle_debugging_cmd(document: vsc.NotebookDocument) {

		if (this.debugging) {
			this.stopDebugger();
		}

		this.debugging = !this.debugging;

		for (let cell of document.cells) {
			if (cell.cellKind === vsc.CellKind?.Code) {
				cell.metadata.breakpointMargin = this.debugging;
			}
		}
	}

	async eval(cell: vsc.NotebookCell): Promise<string> {
		await this.nodeKernel.start();
		if (this.debugging) {
			await this.startDebugger();
		}
		return this.nodeKernel.eval(cell);
	}

	addDebugSession(session: vsc.DebugSession) {
		if (this.activeDebugSession) {
			console.log(`error: there is already a debug session`);
			return;
		}
		this.activeDebugSession = session;
	}

	removeDebugSession(session: vsc.DebugSession) {
		if (this.activeDebugSession !== session) {
			console.log(`error: removed session doesn't match active session`);
			return;
		}
		this.activeDebugSession = undefined;
	}

	createTracker(): vsc.DebugAdapterTracker {
		return this.nodeKernel.createTracker();
	}

	private async startDebugger() {
		if (!this.activeDebugSession) {
			try {
				await vsc.debug.startDebugging(undefined, this.nodeKernel.getLaunchConfig());
			} catch (err) {
				console.log(`error: ${err}`);
			}
		}
	}

	private async stopDebugger() {
		if (this.activeDebugSession) {
			await vsc.commands.executeCommand('workbench.action.debug.stop');
			this.disposables.forEach(d => d.dispose());
			this.disposables = [];
		}
	}
}
