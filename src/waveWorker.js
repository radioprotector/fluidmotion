(function(scope) {
  'use strict';

  const state = {
    subdivisionRows: 0,

    subdivisionColumns: 0,
  
    columnsPerSubdivision: 0,
  
    rowsPerSubdivision: 0,
  
    minVertexDepth: 0,
  
    maxVertexDepth: 0,

    vertexDepthRange: 0,
  
    waveDampingFactor: 0.99,
  
    sourcePositions: [],
  
    resultPositions: [],
  
    pendingPointerEvents: []
  }

  getZ = function(positions, vertexIndex) {
    return positions[(vertexIndex * 3) + 2];
  };

  setZ = function(positions, vertexIndex, value) {
    positions[(vertexIndex * 3) + 2] = value;
  }

  getScaledColor = function(positions, vertexIndex) {
    return (getZ(positions, vertexIndex) - state.minVertexDepth) / state.vertexDepthRange;
  };

  handleInit = function(data) {
    state.subdivisionRows = data.subdivisionRows;
    state.subdivisionColumns = data.subdivisionColumns;
    state.columnsPerSubdivision = data.columnsPerSubdivision;
    state.rowsPerSubdivision = data.rowsPerSubdivision;
    state.minVertexDepth = data.minVertexDepth;
    state.maxVertexDepth = data.maxVertexDepth;
    state.vertexDepthRange = data.maxVertexDepth - data.minVertexDepth;
    state.waveDampingFactor = data.waveDampingFactor;

    // Now create source, result positions, and vertex positions for each subdivision
    for (let subRowIdx = 0; subRowIdx < state.subdivisionRows; subRowIdx++) {
      
      // Ensure that we have arrays for this row index
      state.sourcePositions[subRowIdx] = [];
      state.resultPositions[subRowIdx] = [];

      // Now go through all of the columns in this row and copy the template
      for (let subColIdx = 0; subColIdx < state.subdivisionColumns; subColIdx++) {
        state.sourcePositions[subRowIdx][subColIdx] = new Float32Array(data.vertexPositionTemplate);
        state.resultPositions[subRowIdx][subColIdx] = new Float32Array(data.vertexPositionTemplate);
      }
    }

    // Reset the array of pending pointer events.
    state.pendingPointerEvents = [];
  };

  /**
   * Handles when the a pointer event has been logged.
   */
  handlePointer = function(data) {
    state.pendingPointerEvents.push({
      rowIndex: data.rowIndex,
      columnIndex: data.columnIndex,
      vertexIndex: data.vertexIndex
    });
  };

  /**
   * Handles when the consumer is ready for another wave by performing appropriate propagation operations.
   */
  handleReady = function() {
    const vertexCount = state.rowsPerSubdivision * state.columnsPerSubdivision;

    // First process all pointer events
    for (let pointerEvent of state.pendingPointerEvents) {
      const vertexPositions = state.sourcePositions[pointerEvent.rowIndex][pointerEvent.columnIndex];

      // Map the vertex index * 3 (for x/y/z) and then add 2 more to set the z position
      vertexPositions[(pointerEvent.vertexIndex * 3) + 2] = state.minVertexDepth;
    }
    state.pendingPointerEvents = [];

    // Then perform propagation
    for(let subRowIdx = 0; subRowIdx < state.subdivisionRows; subRowIdx++) {
      for(let subColIdx = 0; subColIdx < state.subdivisionColumns; subColIdx++) {

        // Get source and result positions for the subdivision
        const sourcePositions = state.sourcePositions[subRowIdx][subColIdx];
        const resultPositions = state.resultPositions[subRowIdx][subColIdx];

        for (let vertexIdx = 0; vertexIdx < vertexCount; vertexIdx++) {
          // Map this vertex index to the specific row/column index in the subdivision
          const relativeColumnIdx = vertexIdx % state.rowsPerSubdivision;
          const relativeRowIdx = Math.floor(vertexIdx / state.columnsPerSubdivision);
      
          // Start averaging z-positions across the other 
          let adjacentTotal = 0.0;
      
          // Pull from the row above if possible
          if (relativeRowIdx > 0) {     
            const aboveIdx = vertexIdx - state.columnsPerSubdivision;
            adjacentTotal += getZ(sourcePositions, aboveIdx);
          }
          else if (subRowIdx > 0) {
            // Look at the bottom row of the subdivision above
            const aboveSubdivision = state.sourcePositions[subRowIdx - 1][subColIdx];
            const externalAboveIdx = vertexIdx + (state.columnsPerSubdivision * (state.rowsPerSubdivision - 1));
      
            adjacentTotal += getZ(aboveSubdivision, externalAboveIdx);
          }
      
          // Pull from the row below if possible
          if (relativeRowIdx < state.rowsPerSubdivision - 1) {
            const belowIdx = vertexIdx + state.columnsPerSubdivision;
            adjacentTotal += getZ(sourcePositions, belowIdx);
          }
          else if (subRowIdx < state.subdivisionRows - 1) {
            // Look at the top row of the subdivision below
            const belowSubdivision = state.sourcePositions[subRowIdx + 1][subColIdx];
            const externalBelowIdx = vertexIdx % state.columnsPerSubdivision;
      
            adjacentTotal += getZ(belowSubdivision, externalBelowIdx);
          }
      
          // Pull from the column on the left if possible
          if (relativeColumnIdx > 0) {
            adjacentTotal += getZ(sourcePositions, vertexIdx - 1);
          }
          else if (subColIdx > 0) {
            // Look at the rightmost column of the subdivision to the left
            const leftSubdivision = state.sourcePositions[subRowIdx][subColIdx - 1];
            const externalLeftIdx = vertexIdx + (state.columnsPerSubdivision - 1);
      
            adjacentTotal += getZ(leftSubdivision, externalLeftIdx);
          }
      
          // Pull from the column on the right if possible
          if (relativeColumnIdx < state.columnsPerSubdivision - 1) {
            adjacentTotal += getZ(sourcePositions, vertexIdx + 1);
          }
          else if (subColIdx < state.subdivisionColumns - 1) {
            // Look at the leftmost column of the subdivision to the right
            const rightSubdivision = state.sourcePositions[subRowIdx][subColIdx + 1];
            const externalRightIdx = vertexIdx - (state.columnsPerSubdivision - 1);

            adjacentTotal += getZ(rightSubdivision, externalRightIdx);
          }
      
          // Take twice the average of the adjacent points and subtract it from the current position at this index
          let newZValue = Math.min(state.maxVertexDepth, Math.max(state.minVertexDepth, (adjacentTotal / 2.0) - getZ(resultPositions, vertexIdx)));
      
          // Apply damping and store
          newZValue *= state.waveDampingFactor;
          setZ(resultPositions, vertexIdx, newZValue);
        }
      }
    }

    // Now start building the message, setting transferrable buffers, and doing cleanup
    const transferObjects = [];
    const message = {
      type: 'result',
      vertexPositions: [],
      vertexColors: []
    };
  
    for(let subRowIdx = 0; subRowIdx < state.subdivisionRows; subRowIdx++) {

      // Ensure that we have arrays for this row index
      message.vertexPositions[subRowIdx] = [];
      message.vertexColors[subRowIdx] = [];

      for(let subColIdx = 0; subColIdx < state.subdivisionColumns; subColIdx++) {

        // Get the result positions for this subdivision
        const resultPositions = state.resultPositions[subRowIdx][subColIdx];

        // Copy that into a transferrable array
        const positionArray = new Float32Array(resultPositions);
        message.vertexPositions[subRowIdx][subColIdx] = positionArray;
        transferObjects.push(positionArray.buffer);

        // Generate colors
        const colorArray = new Float32Array(vertexCount * 3)
        for(let vertexIndex = 0, arrayOffset = 0; vertexIndex < vertexCount; vertexIndex++, arrayOffset += 3)
        {
          const scaledColor = getScaledColor(positionArray, vertexIndex);
          colorArray[arrayOffset] = scaledColor;
          colorArray[arrayOffset + 1] = scaledColor;
          colorArray[arrayOffset + 2] = 1.0; // Blue channel is fixed
        }

        message.vertexColors[subRowIdx][subColIdx] = colorArray;
        transferObjects.push(colorArray.buffer);

        // Swap source and result positions for next time
        const swap = resultPositions;
        state.resultPositions[subRowIdx][subColIdx] = state.sourcePositions[subRowIdx][subColIdx];
        state.sourcePositions[subRowIdx][subColIdx] = swap;
      }
    }

    // Post the message
    scope.postMessage(message, transferObjects);
  };

  scope.onmessage = function(e) {
    switch(e.data.type) {
      case 'init':
        handleInit(e.data);
        break;

      case 'pointer':
        handlePointer(e.data);
        break;

      case 'ready':
        handleReady();
        break;

      default:
        console.warn(`unrecognized message type: ${e.data.type}`, e);
    }
  };

})(this);
