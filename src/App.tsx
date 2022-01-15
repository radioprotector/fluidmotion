import React from 'react';
import { Canvas } from '@react-three/fiber';
import { Stats } from '@react-three/drei';

import './App.css';
import WaterPlane from './WaterPlane';

function App(): JSX.Element {
  return (
    <div id="canvas-container">
      <Canvas gl={{alpha: false, antialias: false}}>
        <WaterPlane />
      </Canvas>
      {/* Only include stats and theme reviewer in development */}
      {
        process.env.NODE_ENV !== 'production'
        &&
        <Stats
          showPanel={0}
          className="stats"
        />
      }
    </div>
  );
}

export default App;
