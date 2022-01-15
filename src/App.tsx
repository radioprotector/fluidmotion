import React from 'react';
import { Canvas } from '@react-three/fiber';
import { Stats } from '@react-three/drei';

import { useStore } from './motionState';

import './App.css';
import WaterPlane from './WaterPlane';

function App(): JSX.Element {
  const cycleRain = useStore((state) => state.cycleRainFrequency);
  const cycleScale = useStore((state) => state.cycleScaling);

  return (
    <div id="canvas-container">
      <Canvas gl={{alpha: false, antialias: false}}>
        <WaterPlane />
      </Canvas>
      <div id="control-items">
        <button
          type="button"
          onClick={(e) => { cycleRain(); e.stopPropagation(); return false; }}
        >
          Cycle Rain
        </button>
        <button
          type="button"
          onClick={(e) => { cycleScale(); e.stopPropagation(); return false; }}
        >
          Cycle Scale
        </button>
      </div>
      {/* Only include stats in development */}
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
