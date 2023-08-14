// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { Disposable, Event, EventEmitter, Uri } from 'vscode';
// --- Start Positron ---
import * as vscode from 'vscode';
import * as positron from 'positron';
// --- End Positron ---

import { ICommandManager, IDocumentManager } from '../../common/application/types';
import { Commands } from '../../common/constants';
import '../../common/extensions';
import { IFileSystem } from '../../common/platform/types';
import { IDisposableRegistry, IConfigurationService, Resource } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { IInterpreterService } from '../../interpreter/contracts';
import { IServiceContainer } from '../../ioc/types';
import { traceError } from '../../logging';
import { captureTelemetry, sendTelemetryEvent } from '../../telemetry';
import { EventName } from '../../telemetry/constants';
import { ICodeExecutionHelper, ICodeExecutionManager, ICodeExecutionService } from '../../terminals/types';

@injectable()
export class CodeExecutionManager implements ICodeExecutionManager {
    private eventEmitter: EventEmitter<string> = new EventEmitter<string>();
    constructor(
        @inject(ICommandManager) private commandManager: ICommandManager,
        @inject(IDocumentManager) private documentManager: IDocumentManager,
        @inject(IDisposableRegistry) private disposableRegistry: Disposable[],
        @inject(IFileSystem) private fileSystem: IFileSystem,
        @inject(IConfigurationService) private readonly configSettings: IConfigurationService,
        @inject(IServiceContainer) private serviceContainer: IServiceContainer,
    ) {}

    public get onExecutedCode(): Event<string> {
        return this.eventEmitter.event;
    }

    public registerCommands() {
        [Commands.Exec_In_Terminal, Commands.Exec_In_Terminal_Icon].forEach((cmd) => {
            this.disposableRegistry.push(
                this.commandManager.registerCommand(cmd as any, async (file: Resource) => {
                    const interpreterService = this.serviceContainer.get<IInterpreterService>(IInterpreterService);
                    const interpreter = await interpreterService.getActiveInterpreter(file);
                    if (!interpreter) {
                        this.commandManager.executeCommand(Commands.TriggerEnvironmentSelection, file).then(noop, noop);
                        return;
                    }
                    const trigger = cmd === Commands.Exec_In_Terminal ? 'command' : 'icon';
                    await this.executeFileInTerminal(file, trigger)
                        .then(() => {
                            if (this.shouldTerminalFocusOnStart(file))
                                this.commandManager.executeCommand('workbench.action.terminal.focus');
                        })
                        .catch((ex) => traceError('Failed to execute file in terminal', ex));
                }),
            );
        });
        // --- Start Positron ---
        this.disposableRegistry.push(
            this.commandManager.registerCommand(Commands.Exec_In_Console as any, async () => {
                // Get the active text editor.
                // We get the editor here, rather than passing it in, because passing it in also
                // confuses the Positron Console for a file
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    // No editor; nothing to do
                    return;
                }

                const filePath = editor.document.uri.fsPath;
                if (!filePath) {
                    // File is unsaved; show a warning
                    vscode.window.showWarningMessage('Cannot source unsaved file.');
                    return;
                }

                // Save the file before sourcing it to ensure that the contents are
                // up to date with editor buffer.
                await vscode.commands.executeCommand('workbench.action.files.save');

                try {
                    // Check to see if the fsPath is an actual path to a file using
                    // the VS Code file system API.
                    const fsStat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));

                    // In the future, we will want to shorten the path by making it
                    // relative to the current directory; doing so, however, will
                    // require the kernel to alert us to the current working directory,
                    // or provide a method for asking it to create the `source()`
                    // command.
                    //
                    // For now, just use the full path, passed through JSON encoding
                    // to ensure that it is properly escaped.
                    if (fsStat) {
                        const command = `%run ${JSON.stringify(filePath)}`;
                        positron.runtime.executeCode('python', command, true);
                    }
                } catch (e) {
                    // This is not a valid file path, which isn't an error; it just
                    // means the active editor has something loaded into it that
                    // isn't a file on disk.  In Positron, there is currently a bug
                    // which causes the REPL to act like an active editor. See:
                    //
                    // https://github.com/rstudio/positron/issues/780
                }
            }),
        );
        // --- End Positron ---
        this.disposableRegistry.push(
            this.commandManager.registerCommand(Commands.Exec_Selection_In_Terminal as any, async (file: Resource) => {
                const interpreterService = this.serviceContainer.get<IInterpreterService>(IInterpreterService);
                const interpreter = await interpreterService.getActiveInterpreter(file);
                if (!interpreter) {
                    this.commandManager.executeCommand(Commands.TriggerEnvironmentSelection, file).then(noop, noop);
                    return;
                }
                await this.executeSelectionInTerminal().then(() => {
                    if (this.shouldTerminalFocusOnStart(file))
                        this.commandManager.executeCommand('workbench.action.terminal.focus');
                });
            }),
        );
        this.disposableRegistry.push(
            this.commandManager.registerCommand(
                Commands.Exec_Selection_In_Django_Shell as any,
                async (file: Resource) => {
                    const interpreterService = this.serviceContainer.get<IInterpreterService>(IInterpreterService);
                    const interpreter = await interpreterService.getActiveInterpreter(file);
                    if (!interpreter) {
                        this.commandManager.executeCommand(Commands.TriggerEnvironmentSelection, file).then(noop, noop);
                        return;
                    }
                    await this.executeSelectionInDjangoShell().then(() => {
                        if (this.shouldTerminalFocusOnStart(file))
                            this.commandManager.executeCommand('workbench.action.terminal.focus');
                    });
                },
            ),
        );
    }
    private async executeFileInTerminal(file: Resource, trigger: 'command' | 'icon') {
        sendTelemetryEvent(EventName.EXECUTION_CODE, undefined, { scope: 'file', trigger });
        const codeExecutionHelper = this.serviceContainer.get<ICodeExecutionHelper>(ICodeExecutionHelper);
        file = file instanceof Uri ? file : undefined;
        let fileToExecute = file ? file : await codeExecutionHelper.getFileToExecute();
        if (!fileToExecute) {
            return;
        }
        const fileAfterSave = await codeExecutionHelper.saveFileIfDirty(fileToExecute);
        if (fileAfterSave) {
            fileToExecute = fileAfterSave;
        }

        try {
            const contents = await this.fileSystem.readFile(fileToExecute.fsPath);
            this.eventEmitter.fire(contents);
        } catch {
            // Ignore any errors that occur for firing this event. It's only used
            // for telemetry
            noop();
        }

        const executionService = this.serviceContainer.get<ICodeExecutionService>(ICodeExecutionService, 'standard');
        await executionService.executeFile(fileToExecute);
    }

    @captureTelemetry(EventName.EXECUTION_CODE, { scope: 'selection' }, false)
    private async executeSelectionInTerminal(): Promise<void> {
        const executionService = this.serviceContainer.get<ICodeExecutionService>(ICodeExecutionService, 'standard');

        await this.executeSelection(executionService);
    }

    @captureTelemetry(EventName.EXECUTION_DJANGO, { scope: 'selection' }, false)
    private async executeSelectionInDjangoShell(): Promise<void> {
        const executionService = this.serviceContainer.get<ICodeExecutionService>(ICodeExecutionService, 'djangoShell');
        await this.executeSelection(executionService);
    }

    private async executeSelection(executionService: ICodeExecutionService): Promise<void> {
        const activeEditor = this.documentManager.activeTextEditor;
        if (!activeEditor) {
            return;
        }
        const codeExecutionHelper = this.serviceContainer.get<ICodeExecutionHelper>(ICodeExecutionHelper);
        const codeToExecute = await codeExecutionHelper.getSelectedTextToExecute(activeEditor!);
        const normalizedCode = await codeExecutionHelper.normalizeLines(codeToExecute!);
        if (!normalizedCode || normalizedCode.trim().length === 0) {
            return;
        }

        try {
            this.eventEmitter.fire(normalizedCode);
        } catch {
            // Ignore any errors that occur for firing this event. It's only used
            // for telemetry
            noop();
        }

        await executionService.execute(normalizedCode, activeEditor!.document.uri);
    }

    private shouldTerminalFocusOnStart(uri: Uri | undefined): boolean {
        return this.configSettings.getSettings(uri)?.terminal.focusAfterLaunch;
    }
}
