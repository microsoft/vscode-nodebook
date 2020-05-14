/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { NodeKernel } from './kernel';

export class Project implements vscode.Disposable {

	private document: vscode.NotebookDocument;
	private kernel: NodeKernel;
	private debugging = false;
	private disposables: vscode.Disposable[] = [];
	private activeDebugSession: vscode.DebugSession | undefined;

	constructor(doc: vscode.NotebookDocument) {
		this.document = doc;
		this.kernel = new NodeKernel();
	}

	async dispose() {
		await this.stopDebugger();
		this.kernel.stop();
	}

	public async restartKernel() {
		await this.stopDebugger();
		await vscode.commands.executeCommand('notebook.clearAllCellsOutputs');
		await this.kernel.restart();
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

	public async eval(uri: vscode.Uri, data: string): Promise<string> {

		await this.kernel.start();

		if (this.debugging) {
			await this.startDebugger();
		}
		return this.kernel.eval(uri, data);
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

		return <vscode.DebugAdapterTracker> {
			onWillReceiveMessage: (m: DebugProtocol.ProtocolMessage) => {
				// VS Code -> DA
				visitSources(m, s => {
					if (s && typeof s.path === 'string') {
						this.kernel.mapFromCellUri(s);
					}
				});
			},
			onDidSendMessage: (m: DebugProtocol.ProtocolMessage) => {
				// DA -> VS Code
				visitSources(m, s => {
					if (s) {
						this.kernel.mapToCellUri(s);
					}
				});
			}
		}
	}

	private async startDebugger() {
		if (!this.activeDebugSession) {

			const config = {
				__notebookID: this.document.uri.toString(),
				name: 'nodebook',
				request: 'attach',
				type: 'node',
				port: this.kernel.getDebugPort(),
				timeout: 100000,
				outputCapture: 'std',
				internalConsoleOptions: 'neverOpen'
			};

			try {
				await vscode.debug.startDebugging(undefined, config);
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

// this vistor could be moved into the DAP npm module (it must be kept in sync with the spec)
function visitSources(msg: DebugProtocol.ProtocolMessage, sourceHook: (source: DebugProtocol.Source | undefined) => void): void {

	switch (msg.type) {
		case 'event':
			const event = <DebugProtocol.Event>msg;
			switch (event.event) {
				case 'output':
					sourceHook((<DebugProtocol.OutputEvent>event).body.source);
					break;
				case 'loadedSource':
					sourceHook((<DebugProtocol.LoadedSourceEvent>event).body.source);
					break;
				case 'breakpoint':
					sourceHook((<DebugProtocol.BreakpointEvent>event).body.breakpoint.source);
					break;
				default:
					break;
			}
			break;
		case 'request':
			const request = <DebugProtocol.Request>msg;
			switch (request.command) {
				case 'setBreakpoints':
					sourceHook((<DebugProtocol.SetBreakpointsArguments>request.arguments).source);
					break;
				case 'breakpointLocations':
					sourceHook((<DebugProtocol.BreakpointLocationsArguments>request.arguments).source);
					break;
				case 'source':
					sourceHook((<DebugProtocol.SourceArguments>request.arguments).source);
					break;
				case 'gotoTargets':
					sourceHook((<DebugProtocol.GotoTargetsArguments>request.arguments).source);
					break;
				case 'launchVSCode':
					//request.arguments.args.forEach(arg => fixSourcePath(arg));
					break;
				default:
					break;
			}
			break;
		case 'response':
			const response = <DebugProtocol.Response>msg;
			if (response.success && response.body) {
				switch (response.command) {
					case 'stackTrace':
						(<DebugProtocol.StackTraceResponse>response).body.stackFrames.forEach(frame => sourceHook(frame.source));
						break;
					case 'loadedSources':
						(<DebugProtocol.LoadedSourcesResponse>response).body.sources.forEach(source => sourceHook(source));
						break;
					case 'scopes':
						(<DebugProtocol.ScopesResponse>response).body.scopes.forEach(scope => sourceHook(scope.source));
						break;
					case 'setFunctionBreakpoints':
						(<DebugProtocol.SetFunctionBreakpointsResponse>response).body.breakpoints.forEach(bp => sourceHook(bp.source));
						break;
					case 'setBreakpoints':
						(<DebugProtocol.SetBreakpointsResponse>response).body.breakpoints.forEach(bp => sourceHook(bp.source));
						break;
					default:
						break;
				}
			}
			break;
	}
}

export interface ProjectAssociation {
	(key: string): boolean;
}

export class ProjectContainer {

	private readonly _associations = new Map<string, [ProjectAssociation, Project]>();

	register(key: string, project: Project, association: ProjectAssociation) {
		this._associations.set(key, [association, project]);
	}

	unregister(key: string): Project | undefined {
		const project = this.lookupProject(key);
		if (project) {
			this._associations.delete(key);
		}
		return project;
	}

	lookupProject(keyOrUri: string | vscode.Uri | undefined): Project | undefined {
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
}