import { Cell, CellType } from "@ton/core";

function byteWidth(value: number): number {
  let width = 1;
  while (value >= 256 ** width) width += 1;
  return width;
}

function unsigned(value: number, width: number): Buffer {
  const result = Buffer.alloc(width);
  let remaining = value;
  for (let index = width - 1; index >= 0; index -= 1) {
    result[index] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  if (remaining !== 0) throw new Error("test BOC integer overflow");
  return result;
}

function paddedBits(cell: Cell): Buffer {
  const result = Buffer.alloc(Math.ceil(cell.bits.length / 8));
  for (let index = 0; index < cell.bits.length; index += 1) {
    if (cell.bits.at(index))
      result[Math.floor(index / 8)] |= 1 << (7 - (index % 8));
  }
  if (cell.bits.length % 8 !== 0) {
    const terminator = cell.bits.length;
    result[Math.floor(terminator / 8)] |= 1 << (7 - (terminator % 8));
  }
  return result;
}

function cellKey(cell: Cell): string {
  return cell.hash().toString("hex");
}

function topologicalRoots(roots: readonly Cell[]): Cell[] {
  const cells = new Map<string, Cell>();
  const pending = [...roots];
  while (pending.length > 0) {
    const cell = pending.pop()!;
    const key = cellKey(cell);
    if (cells.has(key)) continue;
    cells.set(key, cell);
    pending.push(...cell.refs);
  }
  const incoming = new Map([...cells.keys()].map((key) => [key, 0]));
  for (const cell of cells.values()) {
    for (const ref of cell.refs) {
      const key = cellKey(ref);
      incoming.set(key, (incoming.get(key) ?? 0) + 1);
    }
  }
  const ready = [...cells.values()].filter(
    (cell) => incoming.get(cellKey(cell)) === 0,
  );
  const result: Cell[] = [];
  for (let cursor = 0; cursor < ready.length; cursor += 1) {
    const cell = ready[cursor];
    result.push(cell);
    for (const ref of cell.refs) {
      const key = cellKey(ref);
      const next = (incoming.get(key) ?? 0) - 1;
      incoming.set(key, next);
      if (next === 0) ready.push(cells.get(key)!);
    }
  }
  if (result.length !== cells.size) throw new Error("test BOC graph is cyclic");
  return result;
}

export function serializeBocRoots(roots: readonly Cell[]): Buffer {
  if (roots.length === 0) throw new Error("test BOC needs roots");
  const cells = topologicalRoots(roots);
  const size = byteWidth(cells.length);
  const indexes = new Map(cells.map((cell, index) => [cellKey(cell), index]));
  const encodedCells = cells.map((cell) => {
    const bits = paddedBits(cell);
    const refsDescriptor =
      cell.refs.length +
      (cell.type === CellType.Ordinary ? 0 : 8) +
      cell.mask.value * 32;
    const bitsDescriptor =
      Math.ceil(cell.bits.length / 8) + Math.floor(cell.bits.length / 8);
    return Buffer.concat([
      Buffer.from([refsDescriptor, bitsDescriptor]),
      bits,
      ...cell.refs.map((ref) => unsigned(indexes.get(cellKey(ref))!, size)),
    ]);
  });
  const totalCellSize = encodedCells.reduce(
    (total, cell) => total + cell.length,
    0,
  );
  const offsetBytes = byteWidth(totalCellSize);
  return Buffer.concat([
    Buffer.from([0xb5, 0xee, 0x9c, 0x72, size, offsetBytes]),
    unsigned(cells.length, size),
    unsigned(roots.length, size),
    unsigned(0, size),
    unsigned(totalCellSize, offsetBytes),
    ...roots.map((root) => unsigned(indexes.get(cellKey(root))!, size)),
    ...encodedCells,
  ]);
}
