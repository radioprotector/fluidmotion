import { ThreeEvent, useFrame } from "@react-three/fiber";
import { useRef, useMemo } from "react";
import { Mesh, PlaneGeometry, BufferGeometry, BufferAttribute, MathUtils, MeshPhongMaterial } from "three";

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
  geometry: BufferGeometry;

  /**
   * The buffer attribute containing source vertex positions.
   */
  sourcePositions: BufferAttribute;

  /**
   * The buffer attribute containing resulting vertex positions after applying propagation logic to the source positions.
   */
  resultPositions: BufferAttribute;
}

// These two values control how many subdivisions will be used for the water plane.
const SUBDIVISION_ROWS = 1;
const SUBDIVISION_COLUMNS = 1;

// These two values control the number of vertices that will be in each plane subdivision, e.g.:
// 256x256 will result in 65,536 vertices
// 512x512 will result in 262,144 vertices
const NUM_ROWS = 256;
const NUM_COLUMNS = 256;

// Track the minimum/maximum Z values for each vertex, and set the starting depth to their average
const MIN_Z_DEPTH = -1.0;
const MAX_Z_DEPTH = 1.0;
const BASE_Z_DEPTH = (MAX_Z_DEPTH + MIN_Z_DEPTH) / 2.0;
const WAVE_DAMPING = 127/128;

/**
 * The material to use for the water.
 */
 const WaterMaterial = new MeshPhongMaterial({color: 0x7777ff, flatShading: true, shininess: 1.0, vertexColors: true});

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
 * Applies coloring to each vertex in the geometry based on its z-depth.
 * @param geometry The buffer geometry that contains position and color data.
 */
function updateVertexColoring(geometry: BufferGeometry) {
  const vertexPositions = geometry.attributes.position;
  const vertexColors = geometry.attributes.color;
  const vertexCount = vertexPositions.count;

  for (let vertexIdx = 0; vertexIdx < vertexCount; vertexIdx++) {
    const vertexZ = vertexPositions.getZ(vertexIdx);
    const colorScale = MathUtils.mapLinear(vertexZ, MIN_Z_DEPTH, MAX_Z_DEPTH, 0.0, 1.0);

    vertexColors.setXYZ(vertexIdx, colorScale, colorScale, 1.0);
  }

  vertexColors.needsUpdate = true;
}

/**
 * Updates the z-depth of vertices in the provided subdivision.
 * @param subdivision The subdivision to update.
 * @see {@link https://web.archive.org/web/20100224054436/http://www.gamedev.net/reference/programming/features/water/page2.asp}
 */
function updateVertexDepth(subdivision: WaterPlaneSubdivision) {
  const vertexCount = subdivision.sourcePositions.count;

  // Vertices are ordered like so:
  // [0 1 2]
  // [3 4 5]
  // [6 7 8]
  for (let vertexIdx = 0; vertexIdx < vertexCount; vertexIdx++) {
    // Map this vertex index to the specific row/column index
    const columnIdx = vertexIdx % NUM_ROWS;
    const rowIdx = Math.floor(vertexIdx / NUM_COLUMNS);

    // Start averaging z-positions across the other 
    let adjacentTotal = 0.0;

    // Pull from the row above if possible
    if (rowIdx > 0) {
      const aboveIdx = vertexIdx - NUM_COLUMNS;

      adjacentTotal += subdivision.sourcePositions.getZ(aboveIdx);
    }

    // Pull from the row below if possible
    if (rowIdx < NUM_ROWS - 1) {
      const belowIdx = vertexIdx + NUM_COLUMNS;

      adjacentTotal += subdivision.sourcePositions.getZ(belowIdx);
    }

    // Pull from the column on the left if possible
    if (columnIdx > 0) {
      adjacentTotal += subdivision.sourcePositions.getZ(vertexIdx - 1);
    }

    // Pull from the column on the right if possible
    if (columnIdx < NUM_COLUMNS - 1) {
      adjacentTotal += subdivision.sourcePositions.getZ(vertexIdx + 1);
    }

    // Take twice the average of the adjacent points and subtract it from the current position at this index
    let newZValue = MathUtils.clamp((adjacentTotal / 2.0) - subdivision.resultPositions.getZ(vertexIdx), MIN_Z_DEPTH, MAX_Z_DEPTH);

    // Apply damping
    newZValue *= WAVE_DAMPING;

    // Debug out-of-range values
    if (process.env.NODE_ENV !== 'production') {
      if (Number.isNaN(newZValue)) {
        //console.debug(`NaN value for ${vertexIdx} at row ${rowIdx} col ${columnIdx}`);
        newZValue = BASE_Z_DEPTH;
      }
    }

    subdivision.resultPositions.setZ(vertexIdx, newZValue);
  }
  
  // Ensure this is updated
  subdivision.resultPositions.needsUpdate = true;
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
  const baseGeometry = new PlaneGeometry(width, height, NUM_COLUMNS - 1, NUM_ROWS - 1);

  // Default everything by the base
  const vertexPositions = baseGeometry.attributes.position;
  const vertexCount = vertexPositions.count;

  for(let vertexIdx = 0; vertexIdx < vertexCount; vertexIdx++) {
    vertexPositions.setZ(vertexIdx, BASE_Z_DEPTH);
  }

  // Attach a color attribute and initialize its coloring
  baseGeometry.setAttribute('color', new BufferAttribute(new Float32Array(vertexCount * 3), 3));
  updateVertexColoring(baseGeometry);

  return baseGeometry;
}

/**
 * Creates and returns the subdivisions for the plane.
 * @param totalPlaneDimensions The width and height of the plane as a whole.
 */
function createSubdivisions(totalPlaneDimensions: number): WaterPlaneSubdivision[] {
  const INITIAL_OFFSET = -totalPlaneDimensions / 2;
  const PLANE_HEIGHT = totalPlaneDimensions / SUBDIVISION_ROWS;
  const PLANE_WIDTH = totalPlaneDimensions / SUBDIVISION_COLUMNS;
  const subdivisions: WaterPlaneSubdivision[] = [];

  for(let rowIdx = 0; rowIdx < SUBDIVISION_ROWS; rowIdx++) {
    let rowVertOffset = INITIAL_OFFSET + (0.5 * PLANE_HEIGHT * ((rowIdx + 1) / SUBDIVISION_ROWS));

    for(let colIdx = 0; colIdx < SUBDIVISION_COLUMNS; colIdx++) {
      let colHorizOffset = INITIAL_OFFSET + (0.5 * PLANE_WIDTH * ((colIdx + 1) / SUBDIVISION_COLUMNS));

      // Start by creating the plane
      const waterGeometry = createWaterPlane(PLANE_HEIGHT, PLANE_WIDTH);

      // Also attach a mesh and position it
      const waterMesh = new Mesh(waterGeometry, WaterMaterial);
      waterMesh.position.set(colHorizOffset, rowVertOffset, -256);

      const subdivision: WaterPlaneSubdivision = {
        key: getSubdivisionKey(rowIdx, colIdx),
        rowIndex: rowIdx,
        columnIndex: colIdx,
        mesh: waterMesh,
        geometry: waterGeometry,
        sourcePositions: waterGeometry.attributes.position as BufferAttribute,
        resultPositions: waterGeometry.attributes.position.clone()
      };

      subdivisions.push(subdivision);
    }
  }

  return subdivisions;
}

function WaterPlane(): JSX.Element {
  const PLANE_DIMENSIONS = 4096;

  // Track when we last updated the buffers
  const lastRenderTime = useRef(0);
  const FRAME_SECONDS = 1/30;

  // Track what's being pointed at
  const pointerSubdivisionRowIndex = useRef(-1);
  const pointerSubdivisionColumnIndex = useRef(-1);
  const pointerVertexIndex = useRef(-1);

  // Build subdivisions, using a ref to maintain between refreshes
  const subdivisions = useRef(createSubdivisions(PLANE_DIMENSIONS));

  // Build other versions of this using a memoized format
  const subdivisionsByUuid: Record<string, WaterPlaneSubdivision> = useMemo(() => {
    const uuidMap: Record<string, WaterPlaneSubdivision> = {};

    subdivisions.current.forEach((sub) => {
      uuidMap[sub.mesh.uuid] = sub;
    });

    return uuidMap;
  }, [subdivisions])

  const subdivisionsByRowCol: WaterPlaneSubdivision[][] = useMemo(() => {
    const rowColArr: WaterPlaneSubdivision[][] = [];

    subdivisions.current.forEach((sub) => {
      // Make sure we have an array defined for the row
      if (rowColArr[sub.rowIndex] === undefined) {
        rowColArr[sub.rowIndex] = [];
      }

      rowColArr[sub.rowIndex][sub.columnIndex] = sub;
    })

    return rowColArr;
  }, [subdivisions]);

  const setCurrentPointer = (e: ThreeEvent<PointerEvent>): void => {
    // If we're only moving, don't bother unless the pointer is down
    if (e.nativeEvent.type === 'pointermove' && pointerVertexIndex.current === -1) {
      return;
    }

    // Now look for intersections
    for(let intersection of e.intersections) {
      // Make sure we're hitting a subdivision
      if (e.object.uuid in subdivisionsByUuid === false) {
        continue;
      }

      // Get the subdivision
      const subdivision = subdivisionsByUuid[e.object.uuid];

      // Get the intersection point in the object
      const intersectionPointWorld = intersection.point;
      const intersectionPointObject = intersection.object.worldToLocal(intersectionPointWorld);

      // If we have a face, use that to easily find which of its vertices is closest to the click
      if (intersection.face) {
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

        // Set the pointer that we're at and exit out
        pointerVertexIndex.current = nearestVertexIdx;
        pointerSubdivisionRowIndex.current = subdivision.rowIndex;
        pointerSubdivisionColumnIndex.current = subdivision.columnIndex;
        e.stopPropagation();
        return;
      }
    }
  };

  const clearCurrentPointer = (e: ThreeEvent<PointerEvent>): void => {
    pointerSubdivisionRowIndex.current = -1;
    pointerSubdivisionColumnIndex.current = -1;
    pointerVertexIndex.current = -1;
  };

  useFrame((state) => {
    // See if we have pointer data to apply - if so, explicitly set the z-value
    // FUTURE: Look at debouncing this if necessary
    if (pointerVertexIndex.current > -1 && pointerSubdivisionRowIndex.current > -1 && pointerSubdivisionColumnIndex.current > -1) {
      const subdivision = subdivisionsByRowCol[pointerSubdivisionRowIndex.current][pointerSubdivisionColumnIndex.current];
      subdivision.sourcePositions.setZ(pointerVertexIndex.current, MIN_Z_DEPTH);
    }

    // // Determine the constraints of the screen and scale to them
    // const screenWidth = window.innerWidth || document.documentElement.clientWidth;
    // const screenHeight = window.innerHeight || document.documentElement.clientHeight;
    // const maxDimension = Math.max(screenWidth, screenHeight);
    // const scaleToMaxDimension = maxDimension / PLANE_DIMENSIONS;

    // if (waterMesh.current.scale.x !== scaleToMaxDimension) {
    //   console.debug(`scaling ${PLANE_DIMENSIONS}x${PLANE_DIMENSIONS} to ${screenWidth}x${screenHeight} w/ ${scaleToMaxDimension.toFixed(2)}`)
    //   waterMesh.current.scale.set(scaleToMaxDimension, scaleToMaxDimension, 1);
    // }
    
    // See if it's time to update the buffers
    if (state.clock.elapsedTime > lastRenderTime.current + FRAME_SECONDS) {

      // Update each subdivision
      for (let subdivision of subdivisions.current) {
        // Update the source and render position buffers
        updateVertexDepth(subdivision);

        // Ensure the two position buffers get swapped
        const temp = subdivision.sourcePositions;
        subdivision.sourcePositions = subdivision.resultPositions;
        subdivision.resultPositions = temp;
      
        // Ensure the geometry uses the new position attribute set and recomputed normals/sphere
        subdivision.geometry.setAttribute("position", subdivision.resultPositions);
        subdivision.geometry.computeVertexNormals();
        subdivision.geometry.computeBoundingSphere();
        
        // After the geometry is up to date, apply vertex coloring
        updateVertexColoring(subdivision.geometry);
      }

      lastRenderTime.current = state.clock.elapsedTime;
    }
  });

  return (
    <group>
      {subdivisions.current.map((subdivision) => {
        return <primitive
          object={subdivision.mesh}
          key={subdivision.key}
          onPointerDown={setCurrentPointer}
          onPointerMove={setCurrentPointer}
          onPointerUp={clearCurrentPointer}
          onPointerLeave={clearCurrentPointer}
          />;
      })}
    </group>
  );
}

export default WaterPlane;
