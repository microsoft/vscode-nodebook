/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { NodeKernel } from './kernel';

export class Project {

	private kernel: NodeKernel | undefined;

	private document?: vscode.NotebookDocument;
	private debugging = false;
	private debuggerActive = false;


	constructor(doc?: vscode.NotebookDocument) {
		this.document = doc;
	}

	public async startKernel() {
		if (!this.kernel) {
			this.kernel = new NodeKernel();
			await this.kernel.start();
		}
	}

	public stopKernel() {
		if (this.kernel) {
			this.kernel.stop();
			this.kernel = undefined;
		}
	}

	private async stopDebugger() {
		if (this.debuggerActive) {
			await vscode.commands.executeCommand('workbench.action.debug.stop');
			// stop debugging
			this.debuggerActive = false;
		}
	}

	public async restartKernel() {
		await this.stopDebugger();
		await this.stopKernel();
		await this.startKernel();
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

	public async eval(uri: vscode.Uri, data: string): Promise<string> {

		await this.startKernel();

		if (this.kernel) {
			if (this.debugging) {
				if (!this.debuggerActive) {
					try {
						await vscode.debug.startDebugging(undefined, this.kernel.getDebugConfiguration());
						this.debuggerActive = true;
					} catch(err) {
						console.log(`error: ${err}`);
					}
				}
			}
			return this.kernel.eval(uri, data);
		}
		return 'no kernel';
	}
}


export interface ProjectAssociation {
	(uri: vscode.Uri): boolean;
}

export class ProjectContainer {

	private readonly _associations = new Map<string, [ProjectAssociation, Project]>();

	register(uri: vscode.Uri, project: Project, association: ProjectAssociation) {
		this._associations.set(uri.toString(), [association, project]);
	}

	lookupProject(uri: vscode.Uri): Project;
	lookupProject(uri: vscode.Uri, fallback: false): Project | undefined;
	lookupProject(uri: vscode.Uri, fallback: boolean = true): Project | undefined {
		for (let [association, value] of this._associations.values()) {
			if (association(uri)) {
				return value;
			}
		}
		if (!fallback) {
			return undefined;
		}
		console.log('returning AD-HOC project for ' + uri.toString());
		const project = new Project();
		this.register(uri, project, candidate => candidate.toString() === uri.toString());
		return project;
	}

	*all(): Iterable<Project> {
		for (let [, value] of this._associations) {
			yield value[1];
		}
	}
}
