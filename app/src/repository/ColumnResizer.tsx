import { Splitter } from "../ui/Splitter";
import { type ColumnWidths, DEFAULT_WIDTHS, maxWidth, MIN_WIDTHS, type ResizableColumn } from "./columnWidths";

interface Props {
  column: ResizableColumn;
  /** What it resizes, to a screen reader, such as "Resize the branches column". */
  label: string;
  /** The id of the column it resizes. */
  controls: string;
  widths: ColumnWidths;
  /** How wide the whole layout is now, in CSS pixels. */
  total: () => number;
  onResize: (width: number) => void;
  onReset: () => void;
}

/**
 * The edge between the Commit graph and the column at its left or right, a
 * {@link Splitter}. Each column keeps its narrowest, and leaves the Commit
 * graph its.
 */
export function ColumnResizer({ column, label, controls, widths, total, onResize, onReset }: Props) {
  return (
    <Splitter
      label={label}
      controls={controls}
      width={widths[column]}
      min={MIN_WIDTHS[column]}
      max={maxWidth(column, widths, total())}
      // Moving the edge right widens the left column, and narrows the right one.
      rightward={column === "sidebar" ? 1 : -1}
      onResize={onResize}
      onReset={onReset}
      resetLabel={`Reset to ${DEFAULT_WIDTHS[column]} pixels`}
    />
  );
}
