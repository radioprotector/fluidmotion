import create, { GetState, SetState } from 'zustand';
import { StoreApiWithSubscribeWithSelector, subscribeWithSelector } from 'zustand/middleware'

/**
 * Describes how the overall view should be scaled.
 */
export enum ScalingMode {
  None = 0,
  ToSmallest = 1,
  ToLargest = 2
};

interface MotionState {
  /**
   * The scaling mode to use.
   * Should correspond with a scaling mode value, although TypeScript makes that difficult.
   */
  scaling: number;

  /**
   * The duration, in seconds, between rainfall instances.
   */
  rainFrequencySeconds: number;

  setScaling: (newScaling: ScalingMode) => void;

  cycleScaling: () => void;

  setRainFrequency: (newFrequencySeconds: number) => void;

  cycleRainFrequency: () => void;
}

export const useStore = create<
  MotionState,
  SetState<MotionState>,
  GetState<MotionState>,
  StoreApiWithSubscribeWithSelector<MotionState>
>(subscribeWithSelector((set) => ({
  scaling: 1,

  rainFrequencySeconds: 0,

  setScaling: (newScaling) => set(state => { 
    state.scaling = newScaling;
  }),

  cycleScaling: () => set(state => {
    // Wrap around
    if (state.scaling >= ScalingMode.ToLargest) {
      state.scaling = 0;
    }
    else {
      state.scaling += 1;
    }
  }),

  setRainFrequency: (newFrequencySeconds) => set(state => {
    state.rainFrequencySeconds = newFrequencySeconds
  }),

  cycleRainFrequency: () => set(state => {
    // Wrap around
    if (state.rainFrequencySeconds === 0) {
      state.rainFrequencySeconds = 1;
    }
    else {
      state.rainFrequencySeconds -= 0.25;
    }
  })
})));
