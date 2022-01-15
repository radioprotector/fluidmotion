/**
 * Describes the message that is sent to initialize the worker.
 */
export interface initMessageToWorker {
  type: 'init';

  /**
   * The number of rows in the subdivision grid.
   */
  subdivisionRows: number;

  /**
   * The number of columns in the subdivision grid.
   */
  subdivisionColumns: number;

  /**
   * The number of vertex columns in each plane subdivision.
   */
  columnsPerSubdivision: number;

  /**
   * The number of vertex rows in each plane subdivision.
   */
  rowsPerSubdivision: number;

  /**
   * A template array of vertex positions to use for each subdivision.
   */
  vertexPositionTemplate: Float32Array;

  /**
   * The minimum possible vertex depth.
   */
  minVertexDepth: number;

  /**
   * The maximum possible vertex depth.
   */
  maxVertexDepth: number;

  /**
   * The percentage, on a 0.0-1.0 scale, to apply to the "amplitude" of each vertex as it is calculated.
   */
  waveDampingFactor: number;
}

/**
 * Describes the message that is sent to tell the worker that it is ready to process another frame.
 */
export interface readyMessageToWorker {
  type: 'ready';
}

/**
 * Describes the message that is sent to tell the worker that a pointer touch event has occurred.
 */
export interface pointerMessageToWorker {
  type: 'pointer';

  /**
   * The row index of the subdivision.
   */
  rowIndex: number;

  /**
   * The column index of the subdivision.
   */
  columnIndex: number;

  /**
   * The index of the affected vertex in the subdivision.
   */
  vertexIndex: number;
}

/**
 * Describes the message that is received from the worker when a wave result has been generated.
 */
export interface resultMessageFromWorker {
  type: 'result';

  /**
   * The floating-point arrays to use for the vertex positions in each subdivision, indexed by subdivision row and column.
   */
  vertexPositions: Float32Array[][];

  /**
   * The floating-point arrays to use for the vertex colors in each subdivision, indexed by subdivision row and column.
   */
  vertexColors: Float32Array[][];
}
