/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataGridWaffle';

// React.
import * as React from 'react';
import { KeyboardEvent, useEffect, useLayoutEffect, useState, WheelEvent } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { generateUuid } from 'vs/base/common/uuid';
import { isMacintosh } from 'vs/base/common/platform';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { pinToRange } from 'vs/base/common/positronUtilities';
import { DataGridRow } from 'vs/base/browser/ui/positronDataGrid/components/dataGridRow';
import { DataGridScrollbar } from 'vs/base/browser/ui/positronDataGrid/components/dataGridScrollbar';
import { DataGridRowHeaders } from 'vs/base/browser/ui/positronDataGrid/components/dataGridRowHeaders';
import { usePositronDataGridContext } from 'vs/base/browser/ui/positronDataGrid/positronDataGridContext';
import { DataGridCornerTopLeft } from 'vs/base/browser/ui/positronDataGrid/components/dataGridCornerTopLeft';
import { DataGridColumnHeaders } from 'vs/base/browser/ui/positronDataGrid/components/dataGridColumnHeaders';
import { DataGridScrollbarCorner } from 'vs/base/browser/ui/positronDataGrid/components/dataGridScrollbarCorner';
import { ExtendColumnSelectionBy, ExtendRowSelectionBy } from 'vs/base/browser/ui/positronDataGrid/classes/dataGridInstance';

/**
 * Constants.
 */
const MOUSE_WHEEL_SENSITIVITY = 50;

/**
 * DataGridWaffleProps interface.
 */
interface DataGridWaffleProps {
	width: number;
	height: number;
}

/**
 * DataGridWaffle component.
 * @param props A DataGridWaffleProps that contains the component properties.
 * @returns The rendered component.
 */
export const DataGridWaffle = (props: DataGridWaffleProps) => {
	// Context hooks.
	const context = usePositronDataGridContext();

	// State hooks.
	const [, setRenderMarker] = useState(generateUuid());
	const [lastWheelEvent, setLastWheelEvent] = useState(0);
	const [wheelDeltaX, setWheelDeltaX] = useState(0);
	const [wheelDeltaY, setWheelDeltaY] = useState(0);

	// Main useEffect. This is where we set up event handlers.
	useEffect(() => {
		// Set the initial screen size.
		context.instance.setScreenSize(props.width, props.height);

		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidUpdate event handler.
		disposableStore.add(context.instance.onDidUpdate(() => {
			setRenderMarker(generateUuid());
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Screen size useEffect.
	useLayoutEffect(() => {
		context.instance.setScreenSize(props.width, props.height);
	}, [props.width, props.height]);

	/**
	 * onKeyDown event handler.
	 * @param e A KeyboardEvent<HTMLDivElement> that describes a user interaction with the keyboard.
	 */
	const keyDownHandler = async (e: KeyboardEvent<HTMLDivElement>) => {
		// Ignore onKeyDown events that arrive while we're receiving onWheelEvents.
		if (e.timeStamp - lastWheelEvent < 250) {
			return;
		}

		// Consumes the event.
		const consumeEvent = () => {
			e.preventDefault();
			e.stopPropagation();
		};

		// Process the code.
		switch (e.code) {
			// Space key.
			case 'Space': {
				// Consume the event.
				consumeEvent();

				// If selection is enabled, process the key.
				if (context.instance.selection) {
					if (e.ctrlKey && !e.shiftKey) {
						context.instance.selectColumn(context.instance.cursorColumnIndex);
					} else if (e.shiftKey && !e.ctrlKey) {
						context.instance.selectRow(context.instance.cursorRowIndex);
					} if (isMacintosh ? e.metaKey : e.ctrlKey && e.shiftKey) {
						context.instance.selectAll();
					}
				}
				break;
			}

			// Home key.
			case 'Home': {
				// Consume the event.
				consumeEvent();

				// Shift + Home does nothing.
				if (e.shiftKey) {
					context.instance.extendRowSelectionUp(ExtendRowSelectionBy.Screen);
					return;
				}

				// On macOS, Ctrl + Home does nothing.
				if (isMacintosh && e.ctrlKey) {
					return;
				}

				// Cmd / Ctrl + Home clears the selection and positions the screen and cursor to the
				// top left.
				if (isMacintosh ? e.metaKey : e.ctrlKey) {
					context.instance.clearSelection();
					context.instance.setScreenPosition(0, 0);
					context.instance.setCursorPosition(0, 0);
					return;
				}

				// Home clears the selection and positions the screen and cursor to the left.
				context.instance.clearSelection();
				context.instance.setFirstColumn(0);
				context.instance.setCursorColumn(0);
				break;
			}

			// End key.
			case 'End': {
				// Consume the event.
				consumeEvent();

				// Shift + End does nothing.
				if (e.shiftKey) {
					context.instance.extendRowSelectionDown(ExtendRowSelectionBy.Screen);
					return;
				}

				// On macOS, Ctrl + End does nothing.
				if (isMacintosh && e.ctrlKey) {
					return;
				}

				// Cmd / Ctrl + End clears the selection and positions the screen and cursor to the
				// bottom right.
				if (isMacintosh ? e.metaKey : e.ctrlKey) {
					context.instance.clearSelection();
					context.instance.setScreenPosition(
						context.instance.maximumFirstColumnIndex,
						context.instance.maximumFirstRowIndex
					);
					context.instance.setCursorPosition(
						context.instance.columns - 1,
						context.instance.rows - 1
					);
					return;
				}

				// End clears the selection and positions the screen and cursor to the left.
				context.instance.clearSelection();
				context.instance.setFirstColumn(context.instance.maximumFirstColumnIndex);
				context.instance.setCursorColumn(context.instance.columns - 1);
				break;
			}

			// Page up key.
			case 'PageUp': {
				// Consume the event.
				consumeEvent();

				// Cmd / Ctrl + PageUp does nothing.
				if (isMacintosh ? e.metaKey : e.ctrlKey) {
					return;
				}

				// Range selection.
				if (e.shiftKey) {
					context.instance.extendRowSelectionUp(ExtendRowSelectionBy.Page);
					return;
				}

				// PageUp clears the selection and moves up by one page, positioning the cursor at
				// the top left of the page.
				context.instance.clearSelection();
				const firstRowIndex = Math.max(
					context.instance.firstRowIndex - (e.altKey ? context.instance.visibleRows * 10 : context.instance.visibleRows),
					0
				);
				context.instance.setFirstRow(firstRowIndex);
				context.instance.setCursorRow(firstRowIndex);
				break;
			}

			// Page down key.
			case 'PageDown': {
				// Consume the event.
				consumeEvent();

				// Cmd / Ctrl + PageDown does nothing.
				if (isMacintosh ? e.metaKey : e.ctrlKey) {
					return;
				}

				// Range selection.
				if (e.shiftKey) {
					context.instance.extendRowSelectionDown(ExtendRowSelectionBy.Page);
					return;
				}

				// PageDown clears the selection and moves down by one page, positioning the cursor
				// at the bottom left of the page.
				context.instance.clearSelection();
				const firstRowIndex = Math.min(
					context.instance.firstRowIndex + (e.altKey ? context.instance.visibleRows * 10 : context.instance.visibleRows),
					context.instance.maximumFirstRowIndex
				);
				context.instance.setFirstRow(firstRowIndex);
				context.instance.setCursorRow(firstRowIndex);
				break;
			}

			// Up arrow key.
			case 'ArrowUp': {
				// Consume the event.
				consumeEvent();

				// Cmd / Ctrl + ArrowUp does nothing.
				if (isMacintosh ? e.metaKey : e.ctrlKey) {
					return;
				}

				// When selection is enabled, perform selection processing.
				if (context.instance.selection) {
					// Extend selection up.
					if (e.shiftKey) {
						context.instance.extendRowSelectionUp(ExtendRowSelectionBy.Row);
						return;
					}

					// Clear selection.
					context.instance.clearSelection();
				}

				// Move the cursor up.
				if (context.instance.cursorRowIndex > 0) {
					context.instance.setCursorRow(context.instance.cursorRowIndex - 1);
					context.instance.scrollToCursor();
				}
				break;
			}

			// Down arrow key.
			case 'ArrowDown': {
				// Consume the event.
				consumeEvent();

				// Cmd / Ctrl + ArrowDown does nothing.
				if (isMacintosh ? e.metaKey : e.ctrlKey) {
					return;
				}

				// When selection is enabled, perform selection processing.
				if (context.instance.selection) {
					// Extend selection down.
					if (e.shiftKey) {
						context.instance.extendRowSelectionDown(ExtendRowSelectionBy.Row);
						return;
					}

					// Clear selection.
					context.instance.clearSelection();
				}

				// Move the cursor down.
				if (context.instance.cursorRowIndex < context.instance.rows - 1) {
					context.instance.setCursorRow(context.instance.cursorRowIndex + 1);
					context.instance.scrollToCursor();
				}
				break;
			}

			// Left arrow key.
			case 'ArrowLeft': {
				// Consume the event.
				consumeEvent();

				// Cmd / Ctrl + ArrowLeft does nothing.
				if (isMacintosh ? e.metaKey : e.ctrlKey) {
					return;
				}

				// When selection is enabled, perform selection processing.
				if (context.instance.selection) {
					// Extend selection left.
					if (e.shiftKey) {
						context.instance.extendColumnSelectionLeft(ExtendColumnSelectionBy.Column);
						return;
					}

					// Clear selection.
					context.instance.clearSelection();
				}

				// Moves the cursor left.
				if (context.instance.cursorColumnIndex > 0) {
					context.instance.setCursorColumn(context.instance.cursorColumnIndex - 1);
					context.instance.scrollToCursor();
				}
				break;
			}

			// Right arrow key.
			case 'ArrowRight': {
				// Consume the event.
				consumeEvent();

				// Cmd / Ctrl + ArrowRight does nothing.
				if (isMacintosh ? e.metaKey : e.ctrlKey) {
					return;
				}

				// When selection is enabled, perform selection processing.
				if (context.instance.selection) {
					// Extend selection right.
					if (e.shiftKey) {
						context.instance.extendColumnSelectionRight(ExtendColumnSelectionBy.Column);
						return;
					}

					// Clear selection.
					context.instance.clearSelection();
				}

				// Move the cursor right.
				context.instance.clearSelection();
				if (context.instance.cursorColumnIndex < context.instance.columns - 1) {
					context.instance.setCursorColumn(context.instance.cursorColumnIndex + 1);
					context.instance.scrollToCursor();
				}
				break;
			}
		}
	};

	/**
	 * onWheel event handler.
	 * @param e A WheelEvent<HTMLDivElement> that describes a user interaction with the mouse wheel.
	 */
	const wheelHandler = (e: WheelEvent<HTMLDivElement>) => {
		// Record the last wheel event.
		setLastWheelEvent(e.timeStamp);

		// Get the delta X and delta Y.
		let deltaX = e.deltaX;
		let deltaY = e.deltaY;

		// When the user is holding the shift key, invert the delta X and delta Y.
		if (e.shiftKey) {
			[deltaX, deltaY] = [deltaY, deltaX];
		}

		// The predominant axis is vertical scrolling. When delta Y is greater than or equal to
		// delta X, ignore and reset the delta X and scroll vertically.
		if (Math.abs(deltaY) >= Math.abs(deltaX)) {
			// Calculate the adjusted wheel delta Y.
			const adjustedWheelDeltaY = wheelDeltaY + (e.altKey ? deltaY * 10 : deltaY);

			// Reset wheel delta X.
			setWheelDeltaX(0);

			// Determine whether there's enough delta Y to scroll one or more rows.
			const rowsToScroll = Math.trunc(adjustedWheelDeltaY / MOUSE_WHEEL_SENSITIVITY);
			if (!rowsToScroll) {
				setWheelDeltaY(adjustedWheelDeltaY);
			} else {
				context.instance.setFirstRow(pinToRange(
					context.instance.firstRowIndex + rowsToScroll,
					0,
					context.instance.maximumFirstRowIndex
				));
				setWheelDeltaY(adjustedWheelDeltaY - (rowsToScroll * MOUSE_WHEEL_SENSITIVITY));
			}
		} else if (Math.abs(deltaX) >= Math.abs(deltaY)) {
			// Calculate the adjusted wheel delta X.
			const adjustedWheelDeltaX = wheelDeltaX + (e.altKey ? deltaX * 10 : deltaX);

			// Determine whether there's enough delta X to scroll one or more columns.
			const columnsToScroll = Math.trunc(adjustedWheelDeltaX / MOUSE_WHEEL_SENSITIVITY);
			if (columnsToScroll) {
				context.instance.setFirstColumn(pinToRange(
					context.instance.firstColumnIndex + columnsToScroll,
					0,
					context.instance.maximumFirstColumnIndex
				));
				setWheelDeltaX(adjustedWheelDeltaX - (columnsToScroll * MOUSE_WHEEL_SENSITIVITY));
			} else {
				setWheelDeltaX(adjustedWheelDeltaX);
			}

			// Reset wheel delta Y.
			setWheelDeltaY(0);
		}
	};

	// Render the data grid rows.
	const dataGridRows: JSX.Element[] = [];
	for (let rowIndex = context.instance.firstRowIndex, top = 0;
		rowIndex < context.instance.rows && top < props.height;
		rowIndex++
	) {
		dataGridRows.push(
			<DataGridRow
				key={`row-${rowIndex}`}
				width={props.width}
				top={top}
				rowIndex={rowIndex} />
		);

		// Adjust the top for the next row.
		top += context.instance.getRowHeight(rowIndex);
	}

	// Render.
	return (
		<div
			tabIndex={1}
			className='data-grid-waffle'
			onKeyDown={keyDownHandler}
			onWheel={wheelHandler}
		>
			{context.instance.columnHeaders && context.instance.rowHeaders &&
				<DataGridCornerTopLeft
					onClick={() => {
						context.instance.setScreenPosition(0, 0);
					}}
				/>
			}

			{context.instance.columnHeaders &&
				<DataGridColumnHeaders
					width={props.width - context.instance.rowHeadersWidth}
					height={context.instance.columnHeadersHeight}
				/>
			}

			{context.instance.rowHeaders &&
				<DataGridRowHeaders
					height={props.height - context.instance.columnHeadersHeight}
				/>
			}

			<div
				className='data-grid-rows'
				style={{
					width: props.width - context.instance.rowHeadersWidth,
					height: props.height - context.instance.columnHeadersHeight
				}}
			>

				{dataGridRows}

				{context.instance.horizontalScrollbar &&
					<DataGridScrollbar
						orientation='horizontal'
						bothScrollbarsVisible={
							context.instance.horizontalScrollbar &&
							context.instance.verticalScrollbar
						}
						scrollbarWidth={context.instance.scrollbarWidth}
						containerWidth={props.width - context.instance.rowHeadersWidth}
						containerHeight={props.height - context.instance.columnHeadersHeight}
						entries={context.instance.columns}
						visibleEntries={context.instance.visibleColumns}
						firstEntry={context.instance.firstColumnIndex}
						maximumFirstEntry={context.instance.maximumFirstColumnIndex}
						onDidChangeFirstEntry={firstColumnIndex =>
							context.instance.setFirstColumn(firstColumnIndex)
						}
					/>
				}

				{context.instance.verticalScrollbar &&
					<DataGridScrollbar
						orientation='vertical'
						bothScrollbarsVisible={
							context.instance.horizontalScrollbar &&
							context.instance.verticalScrollbar
						}
						scrollbarWidth={context.instance.scrollbarWidth}
						containerWidth={props.width - context.instance.rowHeadersWidth}
						containerHeight={props.height - context.instance.columnHeadersHeight}
						entries={context.instance.rows}
						visibleEntries={context.instance.visibleRows}
						firstEntry={context.instance.firstRowIndex}
						maximumFirstEntry={context.instance.maximumFirstRowIndex}
						onDidChangeFirstEntry={firstRowIndex =>
							context.instance.setFirstRow(firstRowIndex)
						}
					/>
				}

				{context.instance.horizontalScrollbar && context.instance.verticalScrollbar &&
					<DataGridScrollbarCorner
						onClick={() => {
							context.instance.setScreenPosition(
								context.instance.maximumFirstColumnIndex,
								context.instance.maximumFirstRowIndex
							);
						}}
					/>
				}
			</div>
		</div>
	);
};
