import { ThreeEvent, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Mesh, PlaneGeometry, BufferGeometry, BufferAttribute, MathUtils } from "three";

const NUM_ROWS = 128;
const NUM_COLUMNS = 128;
const MIN_Z_DEPTH = -1.0;
const MAX_Z_DEPTH = 1.0;
const BASE_Z_DEPTH = (MAX_Z_DEPTH - MIN_Z_DEPTH) / 2.0;

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

// https://web.archive.org/web/20100224054436/http://www.gamedev.net/reference/programming/features/water/page2.asp
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

      // // Also check upper-left and upper-right
      // if (columnIdx > 0) {
      //   adjacentTotal += sourcePositions.getZ(aboveIdx - 1);
      // }

      // if (columnIdx < NUM_COLUMNS - 1) {
      //   adjacentTotal += sourcePositions.getZ(aboveIdx + 1);
      // }
    }

    // Pull from the row below if possible
    if (rowIdx < NUM_ROWS - 1) {
      const belowIdx = vertexIdx + NUM_COLUMNS;

      adjacentTotal += sourcePositions.getZ(belowIdx);

      // // Also check lower-left and lower-right
      // if (columnIdx > 0) {
      //   adjacentTotal += sourcePositions.getZ(belowIdx - 1);
      // }
      
      // if (columnIdx < NUM_COLUMNS - 1) {
      //   adjacentTotal += sourcePositions.getZ(belowIdx + 1);
      // }
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
    newZValue *= 63/64;

    // Debug out-of-range values
    if (process.env.NODE_ENV !== 'production') {
      if (Number.isNaN(newZValue)) {
        console.debug(`NaN value for ${vertexIdx} at row ${rowIdx} col ${columnIdx}`);
        newZValue = BASE_Z_DEPTH;
      }
    }

    renderPositions.setZ(vertexIdx, newZValue);
  }
  
  // Ensure this is updated
  renderPositions.needsUpdate = true;
}

// https://github.com/mrdoob/three.js/blob/master/examples/webgl_geometry_colors.html
function createWaterPlane(width: number, height: number): BufferGeometry {
  // Start with a PlaneGeometry to generate relevant positions/UVs/normals
  // Since the segments act as subdivisions, segment counts need to be 1 less than our goal.
  const baseGeometry = new PlaneGeometry(width, height, NUM_COLUMNS - 1, NUM_ROWS - 1);

  // Set some default positions - everything but the center will be blank
  const vertexPositions = baseGeometry.attributes.position;
  const vertexCount = vertexPositions.count;

  for(let vertexIdx = 0; vertexIdx < vertexCount; vertexIdx++) {
    vertexPositions.setZ(vertexIdx, BASE_Z_DEPTH);
  }

  // // Set the center to a wave
  // const centerVertexIdx = Math.floor(vertexCount / 2 + (NUM_COLUMNS / 2))
  // vertexPositions.setZ(centerVertexIdx, MIN_Z_DEPTH);

  // console.debug(vertexPositions);

  // Attach a color attribute and initialize its coloring
  baseGeometry.setAttribute('color', new BufferAttribute(new Float32Array(vertexCount * 3), 3));
  updateVertexColoring(baseGeometry);

  return baseGeometry;
}

function WaterPlane(): JSX.Element {
  const waterGeometry = useRef(createWaterPlane(512, 512));
  const sourceBuffer = useRef(waterGeometry.current.attributes.position as BufferAttribute);
  const resultBuffer = useRef(waterGeometry.current.attributes.position.clone());
  const lastRenderTime = useRef(0);
  const waterMesh = useRef<Mesh>(null!);
  const FRAME_SECONDS  = 1/30;

  useFrame((state) => {
    if (state.clock.elapsedTime > lastRenderTime.current + FRAME_SECONDS) {
      // Update the source and result buffer
      updateVertexDepth(sourceBuffer.current, resultBuffer.current);
      
      // Ensure the two buffers get swapped
      const temp = sourceBuffer.current;
      sourceBuffer.current = resultBuffer.current;
      resultBuffer.current = temp;
      
      // Ensure the geometry gets swapped and made up-to-date
      waterGeometry.current.setAttribute("position", resultBuffer.current);
      waterGeometry.current.computeVertexNormals();
      waterGeometry.current.computeBoundingBox();
      
      // After the geometry is up to date, apply vertex coloring
      updateVertexColoring(waterGeometry.current);

      lastRenderTime.current = state.clock.elapsedTime;
    }
  });

  const onPointerDown = (e: ThreeEvent<PointerEvent>): void => {
    for(let intersection of e.intersections) {
      // Make sure we're hitting the water mesh
      if (e.object.uuid !== waterMesh.current.uuid) {
        return;
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

        // Now update the source buffer at this index to reflect the depth change
        sourceBuffer.current.setZ(nearestVertexIdx, MIN_Z_DEPTH);
        e.stopPropagation();
      }
    }
  };

  return (
    <mesh
      ref={waterMesh}
      position={[0, 0, -256]}
      onPointerDown={onPointerDown}
    >
      <primitive object={waterGeometry.current} attach="geometry" />
      <meshPhongMaterial color={0x7777ff} flatShading={true} shininess={1} vertexColors={true} />
    </mesh>
  );
}

export default WaterPlane;
