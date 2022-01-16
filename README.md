# fluidmotion

fluidmotion is a browser-based wave pool simulator, inspired by a Nintendo DS homebrew application of the same name.

This project is implemented using the following libraries:

- [React](https://reactjs.org/)
- [three.js](https://threejs.org/)
- [react-three-fiber](https://docs.pmnd.rs/react-three-fiber/getting-started/introduction)
- [zustand](https://docs.pmnd.rs/zustand/introduction)

This project is written in TypeScript and makes use of [the Hooks API](https://reactjs.org/docs/hooks-intro.html). All primary components use the [functional component style](https://reactjs.org/docs/components-and-props.html#function-and-class-components). It was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

The Zustand-based store is primarily used such that the HTML-based `InterfaceControls` component can easily communicate changes to the main functionality in the Three.js canvas-based `WaterPlane` component.

## General Framework

In this project, the primary item that changes is the z-depth of each individual vertex. Depth values are propagated and damped using [Roy Willemse's algorithm for simulating wave propagation](https://web.archive.org/web/20100224054436/http://www.gamedev.net/reference/programming/features/water/page2.asp). After propagation is performed, each vertex's color is assigned based on this depth such that the highest points are assigned a pure white (`#ffffff`), the lowest points are assigned a pure blue (`#0000ff`), and anything in the middle has its red and green channels scaled appropriately.

To allow for touch-based ripples, [pointer events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events) are mapped to specific vertices and their depth is manually overridden while the pointer is still live. Randomly-generated rain uses similar behavior by picking a vertex at random to keep "down".

However, [three.js's built-in pointer event handling](https://docs.pmnd.rs/react-three-fiber/api/events) ultimately did not scale to fit a more detailed model. After some investigation, [the intersection calculations](https://threejs.org/docs/#api/en/core/Raycaster.intersectObject) will attempt to determine the specific intersected face for each object, which performs poorly for large numbers of vertices.

To first attempt to address this, the overall plane was broken up into mesh "subdivisions" arranged in a grid format. The wave propagation mechanism was extended to support checking adjacent subdivisions when at the edge of a specific mesh.

Eventually, that did not prove sufficient either, and so manual raycasting was implemented. This came with several performance benefits, such as being able to more easily filter out pointer events where the pointer is "up", as well as being able to short-circuit intersections if we had previously been intersecting a specific subdivision.

### Web Worker Use

However, even with subdivisions in place and an updated hit testing algorithm, the greater number of vertices to process ultimately became untenable to accomplish in the main UI thread. With that in mind, the wave propagation mechanism was implemented in a separate `waveWorker.js` web worker. The messages sent to and received from the web worker are documented in the `workerInterface.ts` class.

After initialization, the web worker will perform wave propagations on arrays of vertex positions and calculate the corresponding vertex color arrays. Not only does this closely match with the underlying implementation of position and color [`BufferAttributes`](https://threejs.org/docs/api/en/core/BufferAttribute), but the resulting arrays are [transferable across message boundaries](https://developer.mozilla.org/en-US/docs/Glossary/Transferable_objects).

The web worker, once initialized, will process a frame of wave propagation results and transmit those to the main animation thread in `WaterPlane`. The `WaterPlane` will ingest these results, update the color/position attributes for each subdivision, and signal to the web worker that it can begin processing the next frame of wave propagation results.

Pointer events, random rain events, and "reset" requests are signaled to the web worker and incorporated in its next frame of wave propagation results.

### Rain Audio

The majority of rain audio handling is similarly performed by the `WaterPlane` component, as it is responsible for generating rain events to send to the web worker. The `InterfaceControls` component, however, is responsible for enabling suspended audio contexts. This is because in browsers like iOS Safari, audio contexts can only be enabled within click handlers (and asynchronous/Promise-based mechanisms are not counted).

When audio is enabled and a rain event is triggered, the `WaterPlane` component will place a [`PositionalAudio`](https://threejs.org/docs/#api/en/audio/PositionalAudio) element from an internal ring buffer, locate it in roughly the same area as the vertex affected by rain, and randomize audio qualities such as the sound to use, detune amount, and playback rate. It will then update an internal counter to point to the next element in the ring buffer. This is tied to an [`AudioListener`](https://threejs.org/docs/#api/en/audio/AudioListener) that is located at approximately the center of the water plane.
