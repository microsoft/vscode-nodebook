/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { NodeKernel } from './kernel';

export class Project {

	readonly concatDoc: vscode.NotebookConcatTextDocument | undefined;
	private kernel: NodeKernel | undefined;

	constructor(doc?: vscode.NotebookDocument) {
		if (doc) {
			this.concatDoc = vscode.notebook.createConcatTextDocument(doc);
		}
	}

	public async start() {

		if (!this.kernel) {
			this.kernel = new NodeKernel();

			await this.kernel.start();

			vscode.debug.startDebugging(undefined, this.kernel.getDebugConfiguration()).then(() => {
				console.log('ok');
			}, e =>{
				console.log('error ' + e);
			});
		}
	}

	public stop() {
		if (this.kernel) {
			this.kernel.stop();
			this.kernel = undefined;
		}
	}

	public async eval(uri: vscode.Uri, data: string): Promise<string> {

		await this.start();
		if (this.kernel) {
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
