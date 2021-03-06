import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Stats } from '@react-three/drei';

import './App.css';
import WaterPlane from './WaterPlane';
import InterfaceControls from './InterfaceControls';

function App(): JSX.Element {
  return (
    <div id="canvas-container">
      <Suspense fallback={null}>
        <Canvas>
          <WaterPlane />
        </Canvas>
        <InterfaceControls />
      </Suspense>
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
