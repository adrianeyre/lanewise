import type { Painter } from "../repository/graphDrawing";

/** A 2D context that writes down what is drawn, for jsdom, which has no canvas. */
export function canvasRecorder(): Painter & { log: string[]; setTransform: (...matrix: number[]) => void } {
  const log: string[] = [];
  const context = {
    log,
    lineWidth: 1,
    lineCap: "butt" as CanvasLineCap,
    strokeStyle: "" as string | CanvasGradient | CanvasPattern,
    fillStyle: "" as string | CanvasGradient | CanvasPattern,
    setTransform: (...matrix: number[]) => log.push(`scale ${matrix[0]}`),
    clearRect: () => log.push("clear"),
    beginPath: () => log.push("begin"),
    moveTo: (x: number, y: number) => log.push(`move ${x},${y}`),
    lineTo: (x: number, y: number) => log.push(`line ${x},${y}`),
    bezierCurveTo: (...points: number[]) => log.push(`curve ${points.slice(4).join(",")}`),
    arc: (x: number, y: number, radius: number) => log.push(`arc ${x},${y} r${radius}`),
    stroke: () => log.push(`stroke ${String(context.strokeStyle)}`),
    fill: () => log.push(`fill ${String(context.fillStyle)}`),
    font: "",
    textAlign: "start" as CanvasTextAlign,
    textBaseline: "alphabetic" as CanvasTextBaseline,
    fillText: (text: string, x: number, y: number) => log.push(`text ${text} ${x},${y} ${String(context.fillStyle)}`),
    setLineDash: (dash: number[]) => log.push(`dash ${dash.join(",")}`),
    save: () => log.push("save"),
    restore: () => log.push("restore"),
    clip: () => log.push("clip"),
    drawImage: ((_image: CanvasImageSource, x: number, y: number, w?: number, h?: number) =>
      log.push(`image ${x},${y} ${w}x${h}`)) as CanvasRenderingContext2D["drawImage"],
    strokeRect: (x: number, y: number, w: number, h: number) =>
      log.push(`rect ${x},${y} ${w}x${h} ${String(context.strokeStyle)}`),
  };
  return context;
}
