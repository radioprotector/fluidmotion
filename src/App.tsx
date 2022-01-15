import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { Stats } from '@react-three/drei';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import { useStore, ScalingMode } from './motionState';

import './App.css';
import WaterPlane from './WaterPlane';

function App(): JSX.Element {
  const cycleRain = useStore((state) => state.cycleRainStage);
  const cycleScale = useStore((state) => state.cycleScaling);
  const scaleMode: ScalingMode = useStore((state) => state.scaling);
  const rainStage = useStore((state) => state.rainFrequencyStageIndex);

  const scaleModeText = useMemo(() => {
    switch(scaleMode)
    {
      case ScalingMode.ScaleToFitLarger:
        return 'The view is scaled so that the larger dimension is aligned with the screen edges.';

      case ScalingMode.ScaleToFitSmaller:
        return 'The view is scaled so that the smaller dimension is aligned with the screen edges.';

      default:
        return 'The view is centered but kept at 100% scale.';
    }
  }, [scaleMode])

  return (
    <div id="canvas-container">
      <Canvas gl={{alpha: false, antialias: false}}>
        <WaterPlane />
      </Canvas>
      <div id="control-items">
        <button
          type="button"
          title="Toggle rain"
          onClick={(e) => { cycleRain(); e.stopPropagation(); return false; }}
        >
          {/* Index 0 is "off", but it's otherwise in descending order of intensity */}
          {rainStage === 0 && <FontAwesomeIcon fixedWidth={true} icon="sun" />}
          {rainStage === 1 && <FontAwesomeIcon fixedWidth={true} icon="cloud-showers-heavy" />}
          {rainStage === 2 && <FontAwesomeIcon fixedWidth={true} icon="cloud-rain" />}
          {rainStage === 3 && <FontAwesomeIcon fixedWidth={true} icon="cloud-sun-rain" />}
          {rainStage === 4 && <FontAwesomeIcon fixedWidth={true} icon="cloud-sun" />}
        </button>
        <button
          type="button"
          title={scaleModeText}
          onClick={(e) => { cycleScale(); e.stopPropagation(); return false; }}
        >
          {scaleMode === ScalingMode.None && <FontAwesomeIcon fixedWidth={true} icon="expand" />}
          {scaleMode === ScalingMode.ScaleToFitSmaller && <FontAwesomeIcon fixedWidth={true} icon="compress-alt" />}
          {scaleMode === ScalingMode.ScaleToFitLarger && <FontAwesomeIcon fixedWidth={true} icon="expand-alt" />}
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
