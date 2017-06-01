'use strict';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as shell from 'shelljs'

import {
    spawn
} from 'child_process';
import * as moment from 'moment';

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "vscode-markdown-paste-image" is now active!');

    let disposable = vscode.commands.registerCommand('extension.MarkdownPasteImage', () => {
        Paster.paste();
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}

class Paster {

    protected static saveImage(inputVal) {
        if (!inputVal) return;

        let editor = vscode.window.activeTextEditor;
        if (!editor) return;
        
        let fileUri = editor.document.uri;
        if (!fileUri) return;

        let filePath = fileUri.fsPath;

        // User may be input a path with backward slashes (\), so need to replace all '\' to '/'.
        inputVal = inputVal.replace(
            "${workspaceRoot}", vscode.workspace.rootPath).replace(/\\/g, '/');

        if (inputVal && (inputVal.length !== inputVal.trim().length)) {
            vscode.window.showErrorMessage('The specified path is invalid: "' + inputVal + '"');
            return;
        }

        this.createImageDirWithImagePath(inputVal).then(imgPath => {
            // save image and insert to current edit file
            this.saveClipboardImageToFileAndGetPath(imgPath, imagePath => {
                if (!imagePath) return;
                if (imagePath === 'no image') {
                    vscode.window.showInformationMessage('There is not a image in clipboard.');
                    return;
                }

                imagePath = this.renderFilePath(editor.document.languageId, filePath, imagePath);

                editor.edit(edit => {
                    let current = editor.selection;

                    if (current.isEmpty) {
                        edit.insert(current.start, imagePath);
                    } else {
                        edit.replace(current, imagePath);
                    }
                });
            });
        }).catch(err => {
            vscode.window.showErrorMessage('Make folder failed:' + inputVal);
            return;
        });        
    }

    public static paste() {
        // get current edit file path
        let editor = vscode.window.activeTextEditor;
        if (!editor) return;

        let fileUri = editor.document.uri;
        if (!fileUri) return;
        if (fileUri.scheme === 'untitled') {
            vscode.window.showInformationMessage('Before paste image, you need to save current edit file first.');
            return;
        }

        // get selection as image file name, need check
        var selection = editor.selection;
        var selectText = editor.document.getText(selection);

        if (selectText && !/^[a-z_A-Z\-\s0-9\.\\\/]+$/.test(selectText)) {
            vscode.window.showInformationMessage('Your selection is not a valid file name!');
            return;
        }

        // get image destination path
        let folderPathFromConfig = vscode.workspace.getConfiguration('pasteImage').path;

        folderPathFromConfig = folderPathFromConfig.replace("${workspaceRoot}", vscode.workspace.rootPath);

        if (folderPathFromConfig && (folderPathFromConfig.length !== folderPathFromConfig.trim().length)) {
            vscode.window.showErrorMessage('The specified path is invalid: "' + folderPathFromConfig + '"');
            return;
        }

        let imagePath = this.getImagePath(
            fileUri.fsPath, selectText, folderPathFromConfig);
        
        let silence = vscode.workspace.getConfiguration('pasteImage').silence;
        if( silence ) {
            Paster.saveImage(imagePath);
        } else {
            let options: vscode.InputBoxOptions = {
                prompt: "You can change the filename, exist file will be overwrite!.",
                value: imagePath,
                placeHolder: "(e.g:../test/myimage.png)"
            }
            vscode.window.showInputBox(options).then(inputVal => {
                Paster.saveImage(inputVal);
            });
        }
    }

    public static getImagePath(filePath: string, selectText: string, folderPathFromConfig: string): string {
        // image file name
        let imageFileName = "";
        if (!selectText) {
            imageFileName = moment().format("Y-MM-DD-HH-mm-ss") + ".png";
        } else {
            imageFileName = selectText + ".png";
        }

        // image output path
        let folderPath = path.dirname(filePath);
        let imagePath = "";

        // generate image path
        if (path.isAbsolute(folderPathFromConfig)) {
            // important: replace must be done at the end, path.join() will build a path with backward slashes (\)
            imagePath = path.join(folderPathFromConfig, imageFileName).replace(/\\/g, '/');
        } else {
            // important: replace must be done at the end, path.join() will build a path with backward slashes (\)
            imagePath = path.join(folderPath, folderPathFromConfig, imageFileName).replace(/\\/g, '/');
        }

        return imagePath;
    }

    /**
     * create directory for image when directory does not exist
     */
    private static createImageDirWithImagePath(imagePath: string) {
        return new Promise((resolve, reject) => {
            let imageDir = path.dirname(imagePath).replace(/\\/g, '/');

            try {
                shell.mkdir('-p', imageDir);
            } catch (error) {
                console.log(error);
                reject(error);
                return;
            }
            resolve(imagePath);
        });
    }

    /**
     * use applescript to save image from clipboard and get file path
     */
    private static saveClipboardImageToFileAndGetPath(imagePath, cb: (imagePath: string) => void) {
        if (!imagePath) return;

        let platform = process.platform;
        if (platform === 'win32') {
            // Windows
            const scriptPath = path.join(__dirname, '../../res/pc.ps1');
            const powershell = spawn('powershell', [
                '-noprofile',
                '-noninteractive',
                '-nologo',
                '-sta',
                '-executionpolicy', 'unrestricted',
                '-windowstyle', 'hidden',
                '-file', scriptPath,
                imagePath
            ]);
            powershell.on('exit', function (code, signal) {
                // console.log('exit', code, signal);
            });
            powershell.stdout.on('data', function (data: Buffer) {
                cb(data.toString().trim());
            });
        } else if (platform === 'darwin') {
            // Mac
            let scriptPath = path.join(__dirname, '../../res/mac.applescript');

            let ascript = spawn('osascript', [scriptPath, imagePath]);
            ascript.on('exit', function (code, signal) {
                // console.log('exit',code,signal);
            });

            ascript.stdout.on('data', function (data: Buffer) {
                cb(data.toString().trim());
            });
        } else {
            // Linux 

            let scriptPath = path.join(__dirname, '../../res/linux.sh');

            let ascript = spawn('sh', [scriptPath, imagePath]);
            ascript.on('exit', function (code, signal) {
                // console.log('exit',code,signal);
            });

            ascript.stdout.on('data', function (data: Buffer) {
                let result = data.toString().trim();
                if (result == "no xclip") {
                    vscode.window.showInformationMessage('You need to install xclip command first.');
                    return;
                }
                cb(result);
            });
        }
    }

    /**
     * render the image file path dependen on file type
     * e.g. in markdown image file path will render to ![](path)
     */
    public static renderFilePath(languageId: string, docPath: string, imageFilePath: string): string {
        // relative will be add backslash characters so need to replace '\' to '/' here.
        imageFilePath = path.relative(path.dirname(docPath), imageFilePath).replace(/\\/g, '/');

        if (languageId === 'markdown') {
            return `![](${imageFilePath})`;
        } else {
            return imageFilePath;
        }
    }
}