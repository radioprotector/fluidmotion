import { ThreeEvent, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Mesh, PlaneGeometry, BufferGeometry, BufferAttribute, MathUtils } from "three";

// These two values control the number of vertices that will be in the plane, e.g.:
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
 * Updates the z-depth of all vertices in the render buffer attribute to reflect its adjacent vertices.
 * @param sourcePositions The buffer attribute of vertex positions that will be used as sources.
 * @param renderPositions The buffer attribute of vertex positions that will be rendered.
 * @see {@link https://web.archive.org/web/20100224054436/http://www.gamedev.net/reference/programming/features/water/page2.asp}
 */
function updateVertexDepth(sourcePositions: BufferAttribute, renderPositions: BufferAttribute) {
  const vertexCount = sourcePositions.count;

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

      adjacentTotal += sourcePositions.getZ(aboveIdx);
    }

    // Pull from the row below if possible
    if (rowIdx < NUM_ROWS - 1) {
      const belowIdx = vertexIdx + NUM_COLUMNS;

      adjacentTotal += sourcePositions.getZ(belowIdx);
    }

    // Pull from the column on the left if possible
    if (columnIdx > 0) {
      adjacentTotal += sourcePositions.getZ(vertexIdx - 1);
    }

    // Pull from the column on the right if possible
    if (columnIdx < NUM_COLUMNS - 1) {
      adjacentTotal += sourcePositions.getZ(vertexIdx + 1);
    }

    // Take twice the average of the adjacent points and subtract it from the current position at this index
    let newZValue = MathUtils.clamp((adjacentTotal / 2.0) - renderPositions.getZ(vertexIdx), MIN_Z_DEPTH, MAX_Z_DEPTH);

    // Apply damping
    newZValue *= WAVE_DAMPING;

    // Debug out-of-range values
    if (process.env.NODE_ENV !== 'production') {
      if (Number.isNaN(newZValue)) {
        //console.debug(`NaN value for ${vertexIdx} at row ${rowIdx} col ${columnIdx}`);
        newZValue = BASE_Z_DEPTH;
      }
    }

    renderPositions.setZ(vertexIdx, newZValue);
  }
  
  // Ensure this is updated
  renderPositions.needsUpdate = true;
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

function WaterPlane(): JSX.Element {
  const PLANE_DIMENSIONS = 4096;
  const waterMesh = useRef<Mesh>(null!);
  const waterGeometry = useRef(createWaterPlane(PLANE_DIMENSIONS, PLANE_DIMENSIONS));

  // Create two different position buffers to swap with each render/wave propagation pass
  // https://web.archive.org/web/20100224054436/http://www.gamedev.net/reference/programming/features/water/page2.asp
  const sourceBuffer = useRef(waterGeometry.current.attributes.position as BufferAttribute);
  const resultBuffer = useRef(waterGeometry.current.attributes.position.clone());

  // Track when we last updated the buffers
  const lastRenderTime = useRef(0);
  const FRAME_SECONDS = 1/30;

  // Track what's being pointed at
  const pointerVertexIndex = useRef(-1);

  const setCurrentPointer = (e: ThreeEvent<PointerEvent>): void => {
    // If we're only moving, don't bother unless the pointer is down
    if (e.nativeEvent.type === 'pointermove' && pointerVertexIndex.current === -1) {
      return;
    }

    // Now look for intersections
    for(let intersection of e.intersections) {
      // Make sure we're hitting the water mesh
      if (e.object.uuid !== waterMesh.current.uuid) {
        continue;
      }

      // Get the intersection point in the object
      const intersectionPointWorld = intersection.point;
      const intersectionPointObject = intersection.object.worldToLocal(intersectionPointWorld);

      // If we have a face, use that to easily find which of its vertices is closest to the click
      if (intersection.face) {
        let nearestVertexIdx = -1;
        let nearestVertexDistance = Number.MAX_SAFE_INTEGER;

        [intersection.face.a, intersection.face.b, intersection.face.c].forEach((vertexIdx) => {
          // Get the X/Y coordinates of this vertex
          const vertexPositionX = sourceBuffer.current.getX(vertexIdx);
          const vertexPositionY = sourceBuffer.current.getY(vertexIdx);

          // Get the distance to the click X/Y coordinates in object space
          let distanceFromIntersection = Math.sqrt(Math.pow(vertexPositionX - intersectionPointObject.x, 2) + Math.pow(vertexPositionY - intersectionPointObject.y, 2));
          
          if (distanceFromIntersection < nearestVertexDistance) {
            nearestVertexIdx = vertexIdx;
            nearestVertexDistance = distanceFromIntersection;
          }
        });

        // Set the pointer that we're at and exit out
        pointerVertexIndex.current = nearestVertexIdx;
        e.stopPropagation();
        return;
      }
    }
  };

  const clearCurrentPointer = (e: ThreeEvent<PointerEvent>): void => {
    pointerVertexIndex.current = -1;
  };

  useFrame((state) => {
    // See if we have pointer data to apply - if so, explicitly set the z-value
    // FUTURE: Look at debouncing this if necessary
    if (pointerVertexIndex.current > -1) {
      sourceBuffer.current.setZ(pointerVertexIndex.current, MIN_Z_DEPTH);
    }

    // Determine the constraints of the screen and scale to them
    const screenWidth = window.innerWidth || document.documentElement.clientWidth;
    const screenHeight = window.innerHeight || document.documentElement.clientHeight;
    const maxDimension = Math.max(screenWidth, screenHeight);
    const scaleToMaxDimension = maxDimension / PLANE_DIMENSIONS;

    if (waterMesh.current.scale.x !== scaleToMaxDimension) {
      console.debug(`scaling ${PLANE_DIMENSIONS}x${PLANE_DIMENSIONS} to ${screenWidth}x${screenHeight} w/ ${scaleToMaxDimension.toFixed(2)}`)
      waterMesh.current.scale.set(scaleToMaxDimension, scaleToMaxDimension, 1);
    }
    
    // See if it's time to update the buffers
    if (state.clock.elapsedTime > lastRenderTime.current + FRAME_SECONDS) {
      // Update the source and result position buffer
      updateVertexDepth(sourceBuffer.current, resultBuffer.current);
      
      // Ensure the two position buffers get swapped
      const temp = sourceBuffer.current;
      sourceBuffer.current = resultBuffer.current;
      resultBuffer.current = temp;
      
      // Ensure the geometry uses the new position attribute set and recomputed
      waterGeometry.current.setAttribute("position", resultBuffer.current);
      waterGeometry.current.computeVertexNormals();
      waterGeometry.current.computeBoundingBox();
      
      // After the geometry is up to date, apply vertex coloring
      updateVertexColoring(waterGeometry.current);

      lastRenderTime.current = state.clock.elapsedTime;
    }
  });

  return (
    <mesh
      ref={waterMesh}
      position={[0, 0, -256]}
      onPointerDown={setCurrentPointer}
      onPointerMove={setCurrentPointer}
      onPointerUp={clearCurrentPointer}
      onPointerLeave={clearCurrentPointer}
    >
      <primitive
        object={waterGeometry.current}
        attach="geometry"
      />
      <meshPhongMaterial
        color={0x7777ff}
        flatShading={true}
        shininess={1}
        vertexColors={true}
      />
    </mesh>
  );
}

export default WaterPlane;
