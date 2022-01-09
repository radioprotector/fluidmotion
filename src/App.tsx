import React from 'react';
import { Canvas } from '@react-three/fiber';

import './App.css';
import WaterPlane from './WaterPlane';

function App(): JSX.Element {
  return (
    <div id="canvas-container">
      <Canvas>
        <ambientLight intensity={1} />
        <WaterPlane />
        {/* <axesHelper args={[10]} /> */}
      </Canvas>
    </div>
  );
}

export default App;
