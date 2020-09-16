/*---------------------------------------------------------------------------------------------
 *	Copyright (c) Microsoft Corporation. All rights reserved.
 *	Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as PATH from 'path';
import * as os from 'os';
import { DebugProtocol } from 'vscode-debugprotocol';
const rmdir = require('rimraf');
const getPort = require('get-port');


export class NodeKernel {

	private nodeRuntime: cp.ChildProcess | undefined;
	private outputBuffer = '';	// collect output here
	private pathToCell: Map<string, vscode.NotebookCell> = new Map();
	private tmpDirectory?: string;
	private debugPort?: number;

	constructor(private document: vscode.NotebookDocument) {
	}

	public async start() {
		if (!this.nodeRuntime) {

			this.debugPort = await getPort();
			this.nodeRuntime = cp.spawn('node', [
				`--inspect=${this.debugPort}`,
				`-e`, `require('repl').start({ prompt: '', ignoreUndefined: true })`
			]);
			if (this.nodeRuntime.stdout) {
				this.nodeRuntime.stdout.on('data', (data: Buffer) => {
					this.outputBuffer += data.toString();
				});
			}
			if (this.nodeRuntime.stderr) {
				this.nodeRuntime.stderr.on('data', data => {
					console.log(`stderr: ${data}`);
				});
			}
		}
	}

	public getLaunchConfig() {
		return {
			__notebookID: this.document.uri.toString(),
			name: 'nodebook',
			request: 'attach',
			type: 'node2',	// doesn't work with 'pwa-node'
			port: this.debugPort,
			timeout: 100000,
			outputCapture: 'std',
			internalConsoleOptions: 'neverOpen'
		};
	}

	public async restart() {
		this.stop();
		await this.start();
	}

	public stop() {

		if (this.nodeRuntime) {
			this.nodeRuntime.kill();
			this.nodeRuntime = undefined;
		}

		if (this.tmpDirectory) {
			const t = this.tmpDirectory;
			this.tmpDirectory = undefined;
			rmdir(t, { glob: false }, (err: Error | undefined) => {
				if (err) {
					console.log(err);
				}
			});
		}
	}

	public async eval(cell: vscode.NotebookCell): Promise<string> {

		const cellPath = this.dumpCell(cell.uri.toString());
		if (cellPath && this.nodeRuntime && this.nodeRuntime.stdin) {

			this.outputBuffer = '';

			this.nodeRuntime.stdin.write(`.load ${cellPath}\n`);

			await new Promise(res => setTimeout(res, 500));	// wait a bit to collect all output that is associated with this eval
			return Promise.resolve(this.outputBuffer);
		}
		throw new Error('Evaluation failed');
	}

	public createTracker(): vscode.DebugAdapterTracker {

		return {

			onWillReceiveMessage: (m: DebugProtocol.ProtocolMessage) => {
				// VS Code -> Debug Adapter
				visitSources(m, source => {
					if (source.path) {
						const cellPath = this.dumpCell(source.path);
						if (cellPath) {
							source.path = cellPath;
						}
					}
				});
			},

			onDidSendMessage: (m: DebugProtocol.ProtocolMessage) => {
				// Debug Adapter -> VS Code
				visitSources(m, source => {
					if (source.path) {
						let cell = this.pathToCell.get(source.path);
						if (cell) {
							source.path = cell.uri.toString();
							source.name = PATH.basename(cell.uri.fsPath);
							// append cell index to name
							const cellIndex = this.document.cells.indexOf(cell);
							if (cellIndex >= 0) {
								source.name += `, Cell ${cellIndex + 1}`;
							}
						}
					}
				});
			}
		}
	}

	/**
	 * Store cell in temporary file and return its path or undefined if uri does not denote a cell.
	 */
	private dumpCell(uri: string): string | undefined {
		try {
			const cellUri = vscode.Uri.parse(uri, true);
			if (cellUri.scheme === 'vscode-notebook-cell') {
				// find cell in document by matching its URI
				const cell = this.document.cells.find(c => c.uri.toString() === uri);
				if (cell) {
					if (!this.tmpDirectory) {
						this.tmpDirectory = fs.mkdtempSync(PATH.join(os.tmpdir(), 'vscode-nodebook-'));
					}		
					const cellPath = `${this.tmpDirectory}/nodebook_cell_${cellUri.fragment}.js`;
					this.pathToCell.set(cellPath, cell);

					let data = cell.document.getText();
					data += `\n//@ sourceURL=${cellPath}`;	// trick to make node.js report the eval's source under this path
					fs.writeFileSync(cellPath, data);

					return cellPath;
				}
			}
		} catch(e) {
		}
		return undefined;
	}
}

// this vistor could be moved into the DAP npm module (it must be kept in sync with the DAP spec)
function visitSources(msg: DebugProtocol.ProtocolMessage, visitor: (source: DebugProtocol.Source) => void): void {

	const sourceHook = (source: DebugProtocol.Source | undefined) => {
		if (source) {
			visitor(source);
		}
	}

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
