import { useRef, useMemo, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Mesh, PlaneGeometry, BufferGeometry, BufferAttribute, MathUtils, Color, MeshBasicMaterial, Vector2, Raycaster, Intersection } from "three";

import { ScalingMode, useStore } from './motionState';

import { initMessageToWorker, pointerMessageToWorker, readyMessageToWorker, resultMessageFromWorker } from "./workerInterface";

/**
 * Describes a subdivision of the water plane. Used to help reduce overhead for intersection hit testing.
 */
interface WaterPlaneSubdivision {
  /**
   * The unique key for the subdivision.
   */
  key: string;

  /**
   * The row index of this subdivision.
   */
  rowIndex: number;

  /**
   * The column index of this subdivision.
   */
  columnIndex: number;

  /**
   * The mesh for the subdivision.
   */
  mesh: Mesh;

  /**
   * The geometry in use for the mesh.
   */
  geometry: BufferGeometry; // XXX: Contemplate removing now that this is mainly handled by the worker.

  /**
   * The buffer attribute containing source vertex positions.
   */
  sourcePositions: BufferAttribute;  // XXX: Contemplate removing now that this is mainly handled by the worker.
}

/**
 * Describes subdivisions that are indexed first by their row index and then by their column index.
 */
 type SubdivisionsByRowCol = WaterPlaneSubdivision[][];

/**
 * The number of rows in the subdivision grid.
 */
const SUBDIVISION_ROWS = 6;

/**
 * The number of columns in the subdivision grid.
 */
const SUBDIVISION_COLUMNS = 6;

/**
 * This controls the overall width of the plane across all subdivisions.
 */
const TOTAL_PLANE_WIDTH = 1024;

/**
 * This controls the overall height of the plane across all subdivisions.
 */
const TOTAL_PLANE_HEIGHT = 1024;

/**
 * The number of vertex rows in each plane subdivision.
 */
const VERTEX_ROWS = 128;

/**
 * The number of vertex columns in each plane subdivision.
 */
const VERTEX_COLUMNS = 128;

/**
 * The total number of vertices in each plane subdivision.
 */
const VERTEX_COUNT = VERTEX_ROWS * VERTEX_COLUMNS;

/**
 * The amount to damp the wave each time.
 * This is calculated by taking half of the total number of rows, and being just a smidge under that in fractional terms.
 * So if we have a total of 128 rows across all of our subdivisions, we want to use 127/128 as a damping ratio.
 */
const WAVE_DAMPING = ((SUBDIVISION_ROWS * VERTEX_ROWS / 2) - 1)/(SUBDIVISION_ROWS * VERTEX_ROWS / 2);

/**
 * The minimum Z-depth of each vertex.
 */
const MIN_Z_DEPTH = -1.0;

/**
 * The maximum Z-depth of each vertex.
 */
const MAX_Z_DEPTH = 1.0;

/**
 * The base starting Z-depth to use for each vertex.
 */
const BASE_Z_DEPTH = (MAX_Z_DEPTH + MIN_Z_DEPTH) / 2.0;

/**
 * The color value used for the base starting Z-depth.
 * Used to fill the background color.
 */
const BASE_Z_DEPTH_COLOR = MathUtils.mapLinear(BASE_Z_DEPTH, MIN_Z_DEPTH, MAX_Z_DEPTH, 0.0, 1.0);

/**
 * The base color to use.
 */
const BASE_COLOR = new Color(BASE_Z_DEPTH_COLOR, BASE_Z_DEPTH_COLOR, 1.0);

/**
 * The material to use for the water.
 * Use basic material so that we don't need to care about vertex normals.
 */
const WaterMaterial = new MeshBasicMaterial({color: BASE_COLOR, vertexColors: true, fog: false, depthWrite: false});

/**
 * Calculates a subdivision key for the given row/column index.
 * @param rowIndex The row index.
 * @param columnIndex The column index.
 * @returns The corresponding key.
 */
function getSubdivisionKey(rowIndex: number, columnIndex: number): string {
  return `sub${rowIndex}-${columnIndex}`;
}

/**
 * Creates a buffer geometry to represent the water plane, with an additional vertex-specific color buffer attribute.
 * @param width The width, in pixels, of the plane.
 * @param height The height, in pixels, of the plane.
 * @returns The initialized buffer geometry.
 * @see {@link https://github.com/mrdoob/three.js/blob/master/examples/webgl_geometry_colors.html}
 */
function createWaterPlane(width: number, height: number): BufferGeometry {
  // Start with a PlaneGeometry to generate relevant positions/UVs/normals
  // Since the segments act as subdivisions, segment counts need to be 1 less than our goal.
  const baseGeometry = new PlaneGeometry(width, height, VERTEX_COLUMNS - 1, VERTEX_ROWS - 1);

  // Default everything by the base as well as the color
  const vertexPositions = baseGeometry.attributes.position;
  const vertexCount = vertexPositions.count;
  const vertexColors = new Float32Array(vertexCount * 3);

  for(let vertexIdx = 0; vertexIdx < vertexCount; vertexIdx++) {
    vertexPositions.setZ(vertexIdx, BASE_Z_DEPTH);
    vertexColors[(vertexIdx * 3)] = 0.5;
    vertexColors[(vertexIdx * 3) + 1] = 0.5;
    vertexColors[(vertexIdx * 3) + 2] = 1;
  }

  // Attach the color array as an attribute
  baseGeometry.setAttribute('color', new BufferAttribute(vertexColors, 3));

  return baseGeometry;
}

/**
 * Creates and returns the subdivisions for the plane.
 * @param totalWidth The total width of the plane across all subdivisions.
 * @param totalHeight The total height of the plane across all subdivisions.
 */
function createSubdivisions(totalWidth: number, totalHeight: number): WaterPlaneSubdivision[] {
  const widthPerPlane = totalWidth / SUBDIVISION_COLUMNS;
  const heightPerPlane = totalHeight / SUBDIVISION_ROWS;

  const subdivisions: WaterPlaneSubdivision[] = [];

  if (process.env.NODE_ENV !== 'production') {
    const totalVertexCount = SUBDIVISION_COLUMNS * SUBDIVISION_ROWS * VERTEX_COUNT;
    console.debug(`creating ${SUBDIVISION_COLUMNS}x${SUBDIVISION_ROWS} matrix of ${VERTEX_COLUMNS}x${VERTEX_ROWS} vertices each, total ${totalVertexCount} vertices`);
  }

  for(let rowIdx = 0; rowIdx < SUBDIVISION_ROWS; rowIdx++) {
    for(let colIdx = 0; colIdx < SUBDIVISION_COLUMNS; colIdx++) {
      // Start by creating the plane and then build a mesh to combine it
      const waterGeometry = createWaterPlane(widthPerPlane, heightPerPlane);
      const waterMesh = new Mesh(waterGeometry, WaterMaterial);

      // Disable automated matrix updating - distributeAndScaleSubdivisions will handle this
      waterMesh.matrixAutoUpdate = false;

      // Compute the bounding sphere so we can use this for hit testing later on
      waterGeometry.computeBoundingSphere();

      const subdivision: WaterPlaneSubdivision = {
        key: getSubdivisionKey(rowIdx, colIdx),
        rowIndex: rowIdx,
        columnIndex: colIdx,
        mesh: waterMesh,
        geometry: waterGeometry,
        sourcePositions: waterGeometry.attributes.position as BufferAttribute
      };

      subdivisions.push(subdivision);
    }
  }

  // Ensure that the subdivisions are arranged/scaled
  distributeAndScaleSubdivisions(totalWidth, totalHeight, 1, subdivisions);

  return subdivisions;
}

/**
 * Distributes the subdivisions across the total dimensions of the plane.
 * @param totalWidth The total width of the plane across all subdivisions.
 * @param totalHeight The total height of the plane across all subdivisions.
 * @param scaleToApply The global scale to apply to the total width and height.
 * @param subdivisions The subdivisions to distribute and scale so that they are arranged evenly across the total plane dimensions.
 */
function distributeAndScaleSubdivisions(totalWidth: number, totalHeight: number, scaleToApply: number, subdivisions: WaterPlaneSubdivision[]): void {
  const scaledTotalWidth = totalWidth * scaleToApply;
  const scaledTotalHeight = totalHeight * scaleToApply;
  const widthPerPlane = scaledTotalWidth / SUBDIVISION_COLUMNS;
  const heightPerPlane = scaledTotalHeight / SUBDIVISION_ROWS;

  // For the vertical subdivisions we want to go top-to-bottom, but horizontal we want to go left-to-right
  const initialVertOffset = (scaledTotalHeight / 2) - (heightPerPlane / 2);
  const initialHorizOffset = (-scaledTotalWidth / 2) + (widthPerPlane / 2);

  for(let subdivision of subdivisions)
  {
    // Subtract plane heights to go top-to-bottom
    let rowVertOffset = initialVertOffset - (heightPerPlane * subdivision.rowIndex);
    // Add plane widths to go left-to-right
    let colHorizOffset = initialHorizOffset + (widthPerPlane * subdivision.columnIndex);

    // Translate the mesh by the appropriate offset
    subdivision.mesh.position.set(colHorizOffset, rowVertOffset, -256);

    // Apply the scale
    subdivision.mesh.scale.set(scaleToApply, scaleToApply, 1);

    // Update the model matrix
    subdivision.mesh.updateMatrix();
    subdivision.mesh.updateMatrixWorld();
  }
}

/**
 * Finds the vertex in the subdivision that is closest to the provided intersection.
 * @param subdivision The subdivision.
 * @param intersection The intersection data. This must have a face defined.
 * @returns The index of the vertex in the subdivision's mesh that is closest to the intersection.
 */
function findNearestVertex(subdivision: WaterPlaneSubdivision, intersection: Intersection): number {
  // If we don't have a face, then exit out
  if (!intersection.face) {
    return 0;
  }

  // Get the intersection point in the object's coordinates
  const intersectionPointWorld = intersection.point;
  const intersectionPointObject = intersection.object.worldToLocal(intersectionPointWorld);

  // Determine, out of all of the three vertices on the face, which is closest to the intersection point
  let nearestVertexIdx = -1;
  let nearestVertexDistance = Number.MAX_SAFE_INTEGER;

  [intersection.face.a, intersection.face.b, intersection.face.c].forEach((vertexIdx) => {
    // Get the X/Y coordinates of this vertex
    const vertexPositionX = subdivision.sourcePositions.getX(vertexIdx);
    const vertexPositionY = subdivision.sourcePositions.getY(vertexIdx);

    // Get the distance to the click X/Y coordinates in object space
    let distanceFromIntersection = Math.sqrt(Math.pow(vertexPositionX - intersectionPointObject.x, 2) + Math.pow(vertexPositionY - intersectionPointObject.y, 2));
    
    if (distanceFromIntersection < nearestVertexDistance) {
      nearestVertexIdx = vertexIdx;
      nearestVertexDistance = distanceFromIntersection;
    }
  });

  return nearestVertexIdx;
}

function WaterPlane(): JSX.Element {
  // Track the last scale that was used
  const lastPlaneScale = useRef(1);

  // Track when we last updated the buffers
  const lastRenderTime = useRef(0);
  const FRAME_SECONDS = 1/30;

  // Track store-related concerns
  const lastRainTime = useRef(0);
  const rainFrequencySeconds = useRef(useStore.getState().rainFrequencySeconds);
  const scalingMode = useRef(useStore.getState().scaling as ScalingMode);

  useEffect(() => useStore.subscribe(
    state => (rainFrequencySeconds.current = state.rainFrequencySeconds)
  ), []);

  useEffect(() => useStore.subscribe(
    state => (scalingMode.current = state.scaling)
  ), []);

  // Track what's being pointed at
  const pointerSubdivisionRowIndex = useRef(-1);
  const pointerSubdivisionColumnIndex = useRef(-1);
  const pointerVertexIndex = useRef(-1);
  const pointerLastFiredTime = useRef(0);
  const POINTER_DEBOUNCE_SECONDS = 1/30;

  // Build subdivisions, using a ref to maintain the geometry between refreshes
  const subdivisions = useRef(createSubdivisions(TOTAL_PLANE_WIDTH, TOTAL_PLANE_HEIGHT));

  // Build other versions of the subdivisions using a memoized format
  const subdivisionMeshes = useMemo(() => {
    return subdivisions.current.map((sub) => sub.mesh);
  }, [subdivisions]);

  const subdivisionsByUuid: Record<string, WaterPlaneSubdivision> = useMemo(() => {
    const uuidMap: Record<string, WaterPlaneSubdivision> = {};

    subdivisions.current.forEach((sub) => {
      uuidMap[sub.mesh.uuid] = sub;
    });

    return uuidMap;
  }, [subdivisions]);

  const subdivisionsByRowCol: SubdivisionsByRowCol = useMemo(() => {
    const rowColArr: SubdivisionsByRowCol = [];

    subdivisions.current.forEach((sub) => {
      // Make sure we have an array defined for the row
      if (rowColArr[sub.rowIndex] === undefined) {
        rowColArr[sub.rowIndex] = [];
      }

      rowColArr[sub.rowIndex][sub.columnIndex] = sub;
    });

    return rowColArr;
  }, [subdivisions]);

  // Create a web worker to handle the 
  const lastWorkerResult = useRef<resultMessageFromWorker | null>(null);
  const worker = useRef<Worker>(null!);

  useEffect(() => {
    // Create a handler
    const messageHandler = (e: MessageEvent) => {
      if (e.data && e.data.type === 'result') {
        lastWorkerResult.current = e.data;
      }
    };

    const errorHandler = (e: ErrorEvent) => {
      console.error('web worker error', errorHandler);
    }

    // Create the web worker and handlers
    worker.current = new Worker(new URL('./waveWorker.js', import.meta.url));
    worker.current.onmessage = messageHandler;
    worker.current.onerror = errorHandler;

    // Initialize the worker state
    const positionTemplate = new Float32Array(subdivisions.current[0].geometry.getAttribute('position').array);
    const initMessage: initMessageToWorker = {
      type: 'init',
      subdivisionRows: SUBDIVISION_ROWS,
      subdivisionColumns: SUBDIVISION_COLUMNS,
      rowsPerSubdivision: VERTEX_ROWS,
      columnsPerSubdivision: VERTEX_COLUMNS,
      minVertexDepth: MIN_Z_DEPTH,
      maxVertexDepth: MAX_Z_DEPTH,
      waveDampingFactor: WAVE_DAMPING,
      vertexPositionTemplate: positionTemplate
    };

    worker.current.postMessage(initMessage, [positionTemplate.buffer]);

    // Reset the last result
    lastWorkerResult.current = null;

    // Tell the worker to start generating data
    const readyMessage: readyMessageToWorker = {
      type: 'ready'
    };

    worker.current.postMessage(readyMessage);

    // Clean up events and terminate the worker
    return () => {
      worker.current.removeEventListener('message', messageHandler);
      worker.current.removeEventListener('error', errorHandler);
      worker.current.terminate();
      lastWorkerResult.current = null;
    }
  }, []);

  // Manually handle our own touch handling, since this is otherwise a huge drag on performance
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    const raycaster = new Raycaster();
    const raycasterPointer = new Vector2();

    const pointerMoved = (e: PointerEvent): void => {
      // If there's nothing being pressed, clear out everything and exit
      if ((e.buttons & 1) === 0) {
        pointerSubdivisionRowIndex.current = -1;
        pointerSubdivisionColumnIndex.current = -1;
        pointerVertexIndex.current = -1;
        return;
      }
  
      // Don't do anything if this is intended to interact with a button
      if (e.target !== null && (e.target as Element).nodeName === 'BUTTON') {
        return;
      }

      // Normalize pointer coordinates to be in the [-1, 1] range expected by the raycaster.
      // The Y dimension gets flipped to account for HTML's different coordinate system.
      raycasterPointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      raycasterPointer.y = - (e.clientY / window.innerHeight) * 2 + 1
      raycaster.setFromCamera(raycasterPointer, camera);
  
      // See if we were intersecting something beforehand - if so, hit-test that first
      if (pointerVertexIndex.current !== -1) {
        // Look for an intersection with our last subdivision mesh
        const lastSubdivision = subdivisionsByRowCol[pointerSubdivisionRowIndex.current][pointerSubdivisionColumnIndex.current];
        const lastMeshIntersect = raycaster.intersectObject(lastSubdivision.mesh);
  
        if (lastMeshIntersect.length > 0 && lastMeshIntersect[0].face) {
          // Update just the vertex and exit out
          pointerVertexIndex.current = findNearestVertex(lastSubdivision, lastMeshIntersect[0]);
          return;
        }
      }
  
      // Do this the hard way and try to intersect with each mesh
      const intersects = raycaster.intersectObjects(subdivisionMeshes);
  
      for(let intersection of intersects) {
        if (intersection.face) {
          const subdivision = subdivisionsByUuid[intersection.object.uuid];
          pointerVertexIndex.current = findNearestVertex(subdivision, intersection);
          pointerSubdivisionRowIndex.current = subdivision.rowIndex;
          pointerSubdivisionColumnIndex.current = subdivision.columnIndex;
          return;
        }
      }
    }

    window.addEventListener('pointerdown', pointerMoved);
    window.addEventListener('pointermove', pointerMoved);
    window.addEventListener('pointerup', pointerMoved);

    return () => {
      window.removeEventListener('pointerdown', pointerMoved);
      window.removeEventListener('pointermove', pointerMoved);
      window.removeEventListener('pointerup', pointerMoved);
    }
  }, [camera, subdivisionsByUuid, subdivisionsByRowCol, subdivisionMeshes])

  useFrame((state) => {
    state.scene.background = BASE_COLOR;

    // See if we have pointer data to apply and need to debounce - if so, send a message
    if (state.clock.elapsedTime > pointerLastFiredTime.current + POINTER_DEBOUNCE_SECONDS) {
      if (pointerVertexIndex.current > -1 && pointerSubdivisionRowIndex.current > -1 && pointerSubdivisionColumnIndex.current > -1) {
        // Create a message to send to the web worker
        const message: pointerMessageToWorker = {
          type: 'pointer',
          rowIndex: pointerSubdivisionRowIndex.current,
          columnIndex: pointerSubdivisionColumnIndex.current,
          vertexIndex: pointerVertexIndex.current
        }

        worker.current.postMessage(message);
        pointerLastFiredTime.current = state.clock.elapsedTime;
      }
    }

    // See if we're due to add rain
    if (rainFrequencySeconds.current > 0 && state.clock.elapsedTime > lastRainTime.current + rainFrequencySeconds.current) {
      const randomRowIndex = Math.floor(Math.random() * SUBDIVISION_ROWS);
      const randomColumnIndex = Math.floor(Math.random() * SUBDIVISION_COLUMNS);
      const randomVertexIndex = Math.floor(Math.random() * VERTEX_COUNT);

      // Treat this like a regular pointer effect
      const message: pointerMessageToWorker = {
        type: 'pointer',
        rowIndex: randomRowIndex,
        columnIndex: randomColumnIndex,
        vertexIndex: randomVertexIndex
      }

      worker.current.postMessage(message);
      lastRainTime.current = state.clock.elapsedTime;
    }

    // Determine the constraints of the screen and scale to them
    const screenWidth = state.size.width;
    const screenHeight = state.size.height;
    const widthScale = screenWidth / TOTAL_PLANE_WIDTH;
    const heightScale = screenHeight / TOTAL_PLANE_HEIGHT;
    let scaleFactor = 1;

    if (scalingMode.current === ScalingMode.ToSmallest) {
      scaleFactor = Math.max(widthScale, heightScale);
    }
    else if (scalingMode.current === ScalingMode.ToLargest) {
      scaleFactor = Math.min(widthScale, heightScale);
    }

    // See if this is different from what we had last time
    if (lastPlaneScale.current !== scaleFactor) {
      console.debug(`scaling ${TOTAL_PLANE_WIDTH}x${TOTAL_PLANE_HEIGHT} to ${screenWidth}x${screenHeight} w/ ${scaleFactor.toFixed(2)}`);
      distributeAndScaleSubdivisions(TOTAL_PLANE_WIDTH, TOTAL_PLANE_HEIGHT, scaleFactor, subdivisions.current);
      lastPlaneScale.current = scaleFactor;
    }
    
    // See if it's time to update the buffers
    if (state.clock.elapsedTime > lastRenderTime.current + FRAME_SECONDS) {

      // Make sure we have a result
      if (lastWorkerResult.current !== null) {
        for(let subRowIdx = 0; subRowIdx < SUBDIVISION_ROWS; subRowIdx++) {
          for(let subColIdx = 0; subColIdx < SUBDIVISION_COLUMNS; subColIdx++) {
            
            const subdivision = subdivisionsByRowCol[subRowIdx][subColIdx];
            const subdivisionPositions = subdivision.mesh.geometry.getAttribute('position') as BufferAttribute;
            const subdivisionColors = subdivision.mesh.geometry.getAttribute('color') as BufferAttribute;
     
            // const newPositionArray = new Float32Array(lastWorkerResult.current.vertexPositions[subRowIdx][subColIdx], 0, subdivisionPositions.array.length);
            // const newColorArray = new Float32Array(lastWorkerResult.current.vertexColors[subRowIdx][subColIdx], 0, subdivisionColors.array.length);
            const newPositionArray = lastWorkerResult.current.vertexPositions[subRowIdx][subColIdx];
            const newColorArray = lastWorkerResult.current.vertexColors[subRowIdx][subColIdx];
            
            // Copy the positions/colors into the corresponding BufferAttributes
            subdivisionPositions.copyArray(newPositionArray).needsUpdate = true;
            subdivisionColors.copyArray(newColorArray).needsUpdate = true;
          }
        }

        // Clear the last worker result
        lastWorkerResult.current = null;

        // Signal that we're ready for another result to process
        const readyMessage: readyMessageToWorker = { type: 'ready' };
        worker.current.postMessage(readyMessage);

        // Indicate when we last rendered
        lastRenderTime.current = state.clock.elapsedTime;
      }
    }
  });

  return (
    <group>
      {subdivisions.current.map((subdivision) => {
        return <primitive
          object={subdivision.mesh}
          key={subdivision.key}
        />;
      })}
    </group>
  );
}

export default WaterPlane;
