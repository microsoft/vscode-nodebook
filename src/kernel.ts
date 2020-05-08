/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
const rmdir = require('rimraf');
const getPort = require('get-port');

const PREVIEW_JS_DEBUG = false;

interface NodeCellInfo {
	uri: vscode.Uri;
	ref: number;
	name: string;
	path: string;
	fileName: string;
}

export class NodeKernel implements vscode.DebugAdapterTrackerFactory {

	private nodeRuntime: cp.ChildProcess | undefined;
	private buffer: string;
	private disposables: vscode.Disposable[] = [];
	private map: Map<string, NodeCellInfo> = new Map();
	private tmp?: string;
	private port?: number;

	constructor() {
		this.buffer = '';
	}

	public async start() {
		if (!this.nodeRuntime) {

			// hook Source path conversion
			const debugTypes = PREVIEW_JS_DEBUG ? ['pwa-node', 'pwa-chrome'] : ['node', 'node2'];
			this.disposables.push(...debugTypes.map(dt => vscode.debug.registerDebugAdapterTrackerFactory(dt, this)));

			this.port = await getPort();
			this.nodeRuntime = cp.spawn('node', [
				`--inspect=${this.port}`,
				'-e',
				"require('repl').start({ prompt: '', ignoreUndefined: true })"
			]);
			this.disposables.push({
				dispose: () => {
					if (this.nodeRuntime) {
						this.nodeRuntime.kill();
						this.nodeRuntime = undefined;
					}
				}
			});

			if (this.nodeRuntime.stdout) {
				this.nodeRuntime.stdout.on('data', (data: Buffer) => {
					this.buffer += data.toString();
				});
			}
			if (this.nodeRuntime.stderr) {
				this.nodeRuntime.stderr.on('data', data => {
					console.log(`stderr: ${data}`);
				});
			}
		}
	}

	public stop() {
		this.disposables.forEach(d => d.dispose());
		this.disposables = [];
	}

	public async eval(uri: vscode.Uri, data: string): Promise<string> {

		const info = this.getInfo(uri);
		if (info) {
			if (!this.tmp) {
				this.tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-nodebooks-'));
				this.disposables.push({
					dispose: () => {
						rmdir(this.tmp);
					}
				});
			}
			const pathName = `${this.tmp}/${info.fileName}`;
			data += `\n//@ sourceURL=${info.fileName}`
			fs.writeFileSync(pathName, data);

			if (this.nodeRuntime && this.nodeRuntime.stdin) {

				this.buffer = '';

				this.nodeRuntime.stdin.write(`.load ${pathName}\n`);

				await new Promise(res => setTimeout(res, 500));	// wait a bit to collect all output that is associated with this eval
				return Promise.resolve(this.buffer);
			}
		}
		return '';
	}

	public getDebugConfiguration() : vscode.DebugConfiguration {
		return {
			name: 'nodebook',
			request: 'attach',
			type: PREVIEW_JS_DEBUG ? 'pwa-node' : 'node',
			port: this.port,
			timeout: 100000,
			outputCapture: 'std',
			internalConsoleOptions: 'neverOpen'
		};
	}

	// ---- private ----

	private getInfo(uri: vscode.Uri): NodeCellInfo | undefined {
		try {
			const cellInfo = JSON.parse(uri.query);
			const cellNr = cellInfo.cell+1;
			const fileName = `nodebook_cell_${cellNr}.js`;
			const lookupName = `<node_internals>/${fileName}`
			let info = this.map.get(lookupName);
			if (!info) {
				info = {
					uri: uri,
					ref: 0,
					name: `foo.nodebook, cell ${cellNr}`,
					path: lookupName,
					fileName: fileName
				};
				this.map.set(lookupName, info);
			}
			return info;
		} catch(e) {
			return undefined;
		}
	}

	createDebugAdapterTracker(session: vscode.DebugSession) : vscode.ProviderResult<vscode.DebugAdapterTracker> {

		return <vscode.DebugAdapterTracker> {
			// 'sourceHook' is not yet official API
			sourceHook: (s: any) => {
				if (typeof s.path === 'string') {
						// TODO: map something to Engine
						if (s.path.indexOf('vscode-notebook:') === 0) {
						const uri = vscode.Uri.parse(s.path);
						const info = this.getInfo(uri);
						if (info) {
							s.path = info.path;
							s.sourceRef = info.ref;
						}
					} else {
						// check for all nodebook cell related sources (DA -> VS Code)
						// TODO: map something back to Engine
						if (s.path.indexOf('nodebook_cell_') >= 0) {
							// this can only happen if we have created a dummy file for a cell previously, so we have a uri->file mapping (that lacks the source reference)
							let info = this.map.get(s.path);
							if (info) {
								info.ref = s.sourceReference;
								s.name = info.name;
								s.path = info.uri.toString();
								s.sourceReference = 0;
							}
						}
					}
				}
			}
		}
	}
}