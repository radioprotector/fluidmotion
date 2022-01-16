import { useMemo } from 'react';
import { AudioContext } from 'three';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import { useStore, ScalingMode } from './motionState';

import './InterfaceControls.css';

function InterfaceControls(): JSX.Element {
  const initiateReset = useStore((state) => state.initiateReset);
  const cycleRain = useStore((state) => state.cycleRainStage);
  const cycleScale = useStore((state) => state.cycleScaling);
  const toggleAudio = useStore((state) => state.toggleAudioEnabled);
  const scaleMode: ScalingMode = useStore((state) => state.scaling);
  const rainStage = useStore((state) => state.rainFrequencyStageIndex);
  const audioEnabled = useStore((state) => state.isAudioEnabled);

  const scaleModeText = useMemo(() => {
    switch(scaleMode)
    {
      case ScalingMode.ScaleToFitLarger:
        return 'The view is scaled so that the larger dimension is aligned with the screen edges.';

      case ScalingMode.ScaleToFitSmaller:
        return 'The view is scaled so that the smaller dimension is aligned with the screen edges.';

      default:
        return 'The view is centered at original scale.';
    }
  }, [scaleMode]);

  const toggleAudioClickHandler = (e: React.MouseEvent<HTMLButtonElement>): boolean => {
    // Enable the audio context if not yet enabled
    if (!audioEnabled) {
      const audioContext = AudioContext.getContext();

      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }
    }

    toggleAudio();
    e.stopPropagation();
    return false;
  };

  return (
    <div id="control-items">
      {/**
        * Because this is using flex row-reverse order, the items that show up first will be on the far right. 
        */}
      <button
        type="button"
        title={scaleModeText}
        onClick={(e) => { cycleScale(); e.stopPropagation(); return false; }}
      >
        {scaleMode === ScalingMode.None && <FontAwesomeIcon fixedWidth={true} icon="expand" />}
        {scaleMode === ScalingMode.ScaleToFitSmaller && <FontAwesomeIcon fixedWidth={true} icon="compress-alt" />}
        {scaleMode === ScalingMode.ScaleToFitLarger && <FontAwesomeIcon fixedWidth={true} icon="expand-alt" />}
      </button>
      <button
        type="button"
        title="Reset"
        onClick={(e) => { initiateReset(); e.stopPropagation(); return false; }}
      >
        <FontAwesomeIcon fixedWidth={true} icon="eraser" />
      </button>
      <button
        type="button"
        title="Toggle rain audio"
        onClick={toggleAudioClickHandler}
      >
        <span
          className="fa-layers fa-fw"
        >
          <FontAwesomeIcon icon="tint" transform="shrink-2 left-6" />
          {audioEnabled && <FontAwesomeIcon icon="volume-mute" transform="shrink-5 right-6" />}
          {!audioEnabled && <FontAwesomeIcon icon="volume-up" transform="shrink-5 right-6" />}
        </span>
      </button>
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
    </div>
  );
}

export default InterfaceControls;
