/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IEditorConstructionOptions } from 'vs/editor/browser/config/editorConfiguration';
import { CodeEditorWidget, ICodeEditorWidgetOptions } from 'vs/editor/browser/widget/codeEditorWidget';
import { IModelService } from 'vs/editor/common/services/model';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { INotebookKernel } from 'vs/workbench/contrib/notebook/common/notebookKernelService';

/**
 * The ReplInstanceView class is the view that hosts an individual REPL instance.
 */
export class ReplInstanceView extends Disposable {
	private _editor?: CodeEditorWidget;

	constructor(private readonly _kernel: INotebookKernel,
		private readonly _parentElement: HTMLElement,
		@IInstantiationService readonly _instantiationService: IInstantiationService,
		@IModelService private readonly _modelService: IModelService) {
		super();
	}

	render() {
		const h1 = document.createElement('h3');
		h1.innerText = this._kernel.label;
		this._parentElement.appendChild(h1);

		const ed = document.createElement('div');

		// TODO: do not hardcode this
		ed.style.height = '2em';
		this._parentElement.appendChild(ed);

		// Create text model
		const textModel = this._modelService.createModel('', // initial value
			null,      // language selection
			undefined, // resource URI
			true       // mark for simple widget
		);

		// Create editor
		const editorOptions = <IEditorConstructionOptions>{};

		const widgetOptions = <ICodeEditorWidgetOptions>{
			isSimpleWidget: true
		};

		this._editor = this._instantiationService.createInstance(
			CodeEditorWidget,
			ed,
			editorOptions,
			widgetOptions);

		this._register(this._editor);
		this._editor.setModel(textModel);

		// Currently doesn't do anything since we don't have a text model to hook it up to
		this._editor.layout();
	}
}
