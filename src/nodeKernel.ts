/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as PATH from 'path';
import * as os from 'os';
import { DebugProtocol } from 'vscode-debugprotocol';
const rmdir = require('rimraf');
const getPort = require('get-port');


interface NodeCellInfo {
	uri: vscode.Uri;
	ref: number | undefined;
	name: string;
	path: string;
	fileName: string;
}

export class NodeKernel {

	private nodeRuntime: cp.ChildProcess | undefined;
	private buffer: string;
	private map: Map<string, NodeCellInfo> = new Map();
	private tmp?: string;
	private port?: number;

	constructor() {
		this.buffer = '';
	}

	public async start() {
		if (!this.nodeRuntime) {

			this.port = await getPort();
			this.nodeRuntime = cp.spawn('node', [
				`--inspect=${this.port}`,
				'-e',
				"require('repl').start({ prompt: '', ignoreUndefined: true })"
			]);

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

	public getDebugPort() : number | undefined {
		return this.port;
	}

	public async restart() {
		await this.stop();
		await this.start();
	}

	public stop() {

		if (this.nodeRuntime) {
			this.nodeRuntime.kill();
			this.nodeRuntime = undefined;
		}

		if (this.tmp) {
			const t = this.tmp;
			this.tmp = undefined;
			rmdir(t, { glob: false }, (err: Error | undefined) => {
				if (err) {
					console.log(err);
				}
			});
		}
	}

	public async eval(uri: vscode.Uri, data: string): Promise<string> {

		const info = this.getInfo(uri);
		if (info) {
			if (!this.tmp) {
				this.tmp = fs.mkdtempSync(PATH.join(os.tmpdir(), 'vscode-nodebook-'));
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

	public mapFromCellUri(s: DebugProtocol.Source) {
		if (s.path && s.path.indexOf('vscode-notebook-cell:') === 0) {
			const uri = vscode.Uri.parse(s.path);
			const info = this.getInfo(uri);
			if (info) {
				s.path = info.path;
				s.sourceReference = info.ref;
			}
		}
	}

	public mapToCellUri(s: DebugProtocol.Source) {
		// check for all nodebook cell related sources (DA -> VS Code)
		// TODO: map something back to Engine
		if (s.path && s.path.indexOf('nodebook_cell_') >= 0) {
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

	// ---- private ----

	private getInfo(uri: vscode.Uri): NodeCellInfo | undefined {
		try {
			const cellNr = parseInt(uri.fragment) + 1;
			const fileName = `nodebook_cell_${cellNr}.js`;
			const lookupName = `<node_internals>/${fileName}`
			const sourceName = `${PATH.basename(uri.path)}, Cell ${cellNr}`;
			let info = this.map.get(lookupName);
			if (!info) {
				info = {
					uri: uri,
					ref: 0,
					name: sourceName,
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
}
