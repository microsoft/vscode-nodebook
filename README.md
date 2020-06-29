# Javascript Notebook Debugging

A sample Javascript notebook that supports debugging.

The main focus of this sample is to show how to implement notebook debugging functionality based on existing VS Code debugger extensions.

In detail the sample shows how to:
- run (evaluate) notebook cells without debugging,
- intercept DAP messages in order to map back and forth between VS Code's notebook cells and the cell representation used by the underlying Node.js runtime.


## Running the sample

We assume that you have already cloned this repository, ran `yarn` and opened the project in VS Code.

Pressing **F5** opens another VS Code window with a project folder containing a sample notebook.

In order to debug cells you can enable debug mode by pressing the "bug" action in the editors toolbook.
This opens the debug toolbar and makes the breakpoint gutter available where you can set breakpoints.
When you now evaluate cells, breakpoints are hit and you can inspect variables and datastructures in VS Code's usual debugger views and panes.

![Running and evaluating notebook cells](images/debugging-in-nodebook.gif)


## Implementation Notes

These notes cover only the debugging functionality of the notebook implementation which lives mostly in the source file [`nodeKernel.ts`](https://github.com/microsoft/vscode-nodebook/blob/master/src/nodeKernel.ts).

A notebook is a structured document and the individual cells are not directly available for typical debuggers because they expect the code in files on disk or as interactive input when in REPL mode.

In the Nodebook sample we are using a Node.js runtime in REPL mode as the notebook's kernel. The following snippet shows how node.js is started and then expects to receive input via stdin:

```ts
  this.nodeRuntime = cp.spawn('node', [
    `--inspect=${this.debugPort}`,
    "-e",
    "require('repl').start({ prompt: '', ignoreUndefined: true })"
  ])
```

One problem with this approach is that node.js REPL is single line oriented whereas notebooks cell have multiple lines.

We work around this problem by using the REPL's `.load <filename>` directive which loads the code from the given file and then excutes it. This approach requires that we have to dump the cell's content into a temporary file before the `.load <filename>` is run:

```ts
  public async eval(cell: vscode.NotebookCell): Promise<string> {

    const cellPath = this.dumpCell(cell.uri.toString());
    this.nodeRuntime.stdin.write(`.load ${cellPath}\n`);

    // collect output from node.js runtime

    return output;
  }
```

The `NodeKernel.dumpCell` utility checks whether the given Uri denotes a cell in the notebook and if it does the cell's content is stored in a temporary file.

```ts
  private dumpCell(uri: string): string | undefined {
    try {
      const cellUri = vscode.Uri.parse(uri, true);
      if (cellUri.scheme === 'vscode-notebook-cell') {
        // find cell in document by matching its URI
        const cell = this.document.cells.find(c => c.uri.toString() === uri);
        if (cell) {
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
```

VS Code manages breakpoints autonomously from debuggers based on document URIs. When a debug session is started, VS Code sends the breakpoint data to the debug extension and it expects to receive the source location for a hit breakpoint again based on document URIs.

The same holds for notebooks where each cell has its own document with its own cell URI.
So notebook cell breakpoints are just like regular breakpoints, the only difference being a cell URI.

Because we store the cell contents in temporary files before the debugger sees them, we need to replace the cell URI of breakpoints to the paths of the corresponding temporary file when talking to the debugger, and the reversed when receiving data from the debugger.

These transformations can be easily achieved by use of the `vscode.DebugAdapterTracker` which has full access to the communication between VS Code and the debug adapter. A `DebugAdapterTracker` can be created and installed for a debug session by means of a factory which is registered for a specific debug type:

```ts
  vscode.debug.registerDebugAdapterTrackerFactory('node', {
    createDebugAdapterTracker: (session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterTracker> => {
      const kernel: NodeKernel = ... // find the NodeKernel that corresponds to the given debug session
      if (kernel) {
          return kernel.createTracker();
      }
      return undefined;
    }
  });
```

For the actual tranformation we have to find all places in the DAP protocol where file paths are used. These places are all represented by the `DebugProtocol.Source` interface and the visitor function `visitSources` can be used to "visit" those places and perform the mapping (since the `visitSources` function depends heavily on the DAP specification, it should really live in the corresponding DAP npm module, but for now this sample just contains a copy that might get out of date).


```ts
  public createTracker(): vscode.DebugAdapterTracker {

    return <vscode.DebugAdapterTracker>{

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
```


Two maps are used for mapping cell URIs to temp file paths and temp file paths back to `vscode.NotebookCell`:

```ts
  private pathToCell: Map<string, vscode.NotebookCell> = new Map();
```


With this the receiving side in the `XeusDebugAdapter` becomes this:


We just try to map a source path to a cell and if there is one, we use the cell's URI. The display name of the source is set to the notebooks base name followed by the cell's index with the notebook.


Mapping into the other direction is very similar but with a twist:
in this case we not only have to map cell URIs to temporary file paths but we have to trigger the actual creation of the temporary files and to update the dictionaries used for the mapping.

Since xeus is a notebook kernel that supports cell debugging, xeus provides support for storing cell contents in temporary files via an extension to the Debug Adapter Protocol. The `dumpCell` request takes the contents of a cell as a string, saves it to disk, and returns a path to the file.

VS Code can easily use this custom DAP request via the extension API `DebugSession.customRequest`. Here is the resulting utility for storing a cell and updating the maps:


With this the outbound mapping in the `XeusDebugAdapter` becomes this:


First we detect the `setBreakpoint` request and then we store the cell's contents in the temporary file.
After this we use `visitSources` to perform the "cell to path" mapping.
