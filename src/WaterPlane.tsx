import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { PlaneGeometry, BufferGeometry, BufferAttribute, MathUtils } from "three";

const NUM_ROWS = 128;
const NUM_COLUMNS = 128; 

function updateVertexColoring(geometry: BufferGeometry) {
  const vertexPositions = geometry.attributes.position;
  const vertexColors = geometry.attributes.color;
  const vertexCount = vertexPositions.count;
  const MAX_DEPTH = 1.0;
  const MIN_DEPTH = -1.0;

  for (let vertexIdx = 0; vertexIdx < vertexCount; vertexIdx++) {
    const vertexZ = vertexPositions.getZ(vertexIdx);
    const colorScale = MathUtils.mapLinear(vertexZ, MIN_DEPTH, MAX_DEPTH, 0.0, 1.0);
    vertexColors.setXYZ(vertexIdx, colorScale, colorScale, 1.0);
  }

  vertexColors.needsUpdate = true;
}

function updateVertexDepth(geometry: BufferGeometry, scratchPositions: BufferAttribute) {
  const vertexPositions = geometry.attributes.position as BufferAttribute;
  const vertexCount = vertexPositions.count;

  // Ensure that the scratch buffer contains all of the existing positions
  scratchPositions.copy(vertexPositions);

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
      adjacentTotal += scratchPositions.getZ(vertexIdx - NUM_COLUMNS);
    }

    // Pull from the row below if possible
    if (rowIdx < NUM_ROWS - 1) {
      adjacentTotal += scratchPositions.getZ(vertexIdx + NUM_COLUMNS);
    }

    // Pull from the column on the left if possible
    if (columnIdx > 0) {
      adjacentTotal += scratchPositions.getZ(vertexIdx - 1);
    }

    // Pull from the column on the right if possible
    if (columnIdx < NUM_COLUMNS - 1) {
      adjacentTotal += scratchPositions.getZ(vertexIdx + 1);
    }

    // Take twice the average of the adjacent points and subtract it from the current position at this index
    let newZValue = MathUtils.clamp((adjacentTotal / 2.0) - vertexPositions.getZ(vertexIdx), -1.0, 1.0);

    // Apply damping
    newZValue *= 0.75;

    // Debug out-of-range values
    if (process.env.NODE_ENV !== 'production') {
      if (Number.isNaN(newZValue)) {
        console.debug(`NaN value for ${vertexIdx} at row ${rowIdx} col ${columnIdx}`);
        newZValue = 0;
      }
    }

    vertexPositions.setZ(vertexIdx, newZValue);
  }
  
  // Ensure this is updated
  vertexPositions.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeVertexNormals();
}

// https://github.com/mrdoob/three.js/blob/master/examples/webgl_geometry_colors.html
function createWaterPlane(width: number, height: number): BufferGeometry {
  // Start with a PlaneGeometry to generate relevant positions/UVs/normals
  // Since the segments act as subdivisions, segment counts need to be 1 less than our goal.
  const baseGeometry = new PlaneGeometry(width, height, NUM_COLUMNS - 1, NUM_ROWS - 1);

  // Set some default positions
  const vertexPositions = baseGeometry.attributes.position;
  const vertexCount = vertexPositions.count;

  // Start at the center item
  vertexPositions.setZ(Math.floor(vertexCount / 2 + (NUM_COLUMNS / 2)), 1.0);

  console.debug(vertexPositions);

  // Attach a color attribute and initialize its coloring
  baseGeometry.setAttribute('color', new BufferAttribute( new Float32Array( vertexCount * 3 ), 3 ) );
  updateVertexColoring(baseGeometry);

  return baseGeometry;
}

function WaterPlane(): JSX.Element {
  const waterGeometry = useRef(createWaterPlane(512, 512));
  const scratchBuffer = useRef(waterGeometry.current.attributes.position.clone());
  const lastRenderTime = useRef(0);
  const FRAME_SECONDS  = 1/20;

  useFrame((state) => {
    if (state.clock.elapsedTime > lastRenderTime.current + FRAME_SECONDS) {
      updateVertexDepth(waterGeometry.current, scratchBuffer.current);
      updateVertexColoring(waterGeometry.current);
      lastRenderTime.current = state.clock.elapsedTime;
    }
  });

  return (
    <mesh
      position={[0, 0, -256]}
    >
      <primitive object={waterGeometry.current} attach="geometry" />
      <meshPhongMaterial color={0x7777ff} flatShading={true} shininess={0} vertexColors={true} />
    </mesh>
  );
}

export default WaterPlane;
