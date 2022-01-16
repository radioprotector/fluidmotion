import create, { GetState, SetState } from 'zustand';
import { StoreApiWithSubscribeWithSelector, subscribeWithSelector } from 'zustand/middleware'

/**
 * Describes how the overall plane should be scaled.
 */
export enum ScalingMode {
  /**
   * No scaling will take place.
   */
  None = 0,

  /**
   * If set, will scale the plane such that the screen edges will align with the smaller of the two dimensions,
   * leaving gaps on either side for the larger dimension.
   */
  ScaleToFitSmaller = 1,

  /**
   * If set, will scale the plane such that the screen edges will align with the wider of the two dimensions,
   * resulting in content being displayed off-screen for the smaller dimension.
   */
  ScaleToFitLarger = 2
};

/**
 * Describes the frequency, in seconds, at which rain will fall for the given stage index.
 */
const rainFrequencyStages = [0, 0.15, 0.5, 1, 1.5];

interface MotionState {
  /**
   * The scaling mode to use.
   */
  scaling: ScalingMode;

  /**
   * The duration, in seconds, between rainfall instances.
   */
  rainFrequencySeconds: number;

  rainFrequencyStageIndex: number;

  /**
   * The last time a reset was triggered.
   */
  lastResetTime: number;

  isAudioEnabled: boolean,

  setScaling: (newScaling: ScalingMode) => void;

  cycleScaling: () => void;

  setRainStage: (newStageIndex: number) => void;

  cycleRainStage: () => void;

  initiateReset: () => void;

  toggleAudioEnabled: () => void;
}

export const useStore = create<
  MotionState,
  SetState<MotionState>,
  GetState<MotionState>,
  StoreApiWithSubscribeWithSelector<MotionState>
>(subscribeWithSelector((set) => ({
  scaling: ScalingMode.ScaleToFitLarger as ScalingMode,
  rainFrequencySeconds: 0,
  rainFrequencyStageIndex: 0,
  lastResetTime: 0,
  isAudioEnabled: false as boolean,

  setScaling: (newScaling) => set(state => { 
    state.scaling = newScaling;
  }),

  cycleScaling: () => set(state => {
    // Wrap around
    if (state.scaling >= ScalingMode.ScaleToFitLarger) {
      state.scaling = 0;
    }
    else {
      state.scaling += 1;
    }
  }),

  setRainStage: (newStageIndex) => set(state => {
    // Assign the index if it's within bounds
    if (newStageIndex >= 0 && newStageIndex < rainFrequencyStages.length) {
      state.rainFrequencyStageIndex = newStageIndex;

      // Cascade to the frequency in seconds
      state.rainFrequencySeconds = rainFrequencyStages[newStageIndex];
    }
  }),

  cycleRainStage: () => set(state => {
    // Wrap around the stage
    if (state.rainFrequencyStageIndex === 0) {
      state.rainFrequencyStageIndex = rainFrequencyStages.length - 1;
    }
    else {
      state.rainFrequencyStageIndex -= 1;
    }

    // Cascade to the frequency in seconds
    state.rainFrequencySeconds = rainFrequencyStages[state.rainFrequencyStageIndex];
  }),

  initiateReset: () => set(state => {
    state.lastResetTime = Date.now();
  }),

  toggleAudioEnabled: () => set(state => {
    state.isAudioEnabled = !state.isAudioEnabled;
  })
})));
