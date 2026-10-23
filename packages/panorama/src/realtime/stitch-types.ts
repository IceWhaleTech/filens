export interface StitchLens {
  center: [number, number];
  focal: [number, number];
  principalOffset: [number, number];
  rotationQuat: number[];
  scale: [number, number];
  validRadius: [number, number];
  radial: number[];
  tangential: number[];
  thinPrism: number[];
  sensorTilt: number[];
  xi: number;
  radialScale: number;
  axis: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
  projectionModel: 'mei_extended' | 'dji_fisheye_lut' | 'equidistant';
  distortionModel?: 'radtan_pro';
  distortionCoeffs?: number[];
  translationM?: number[];
}

export interface StitchCalibration {
  imageSize: [number, number];
  textureOrigin: 'top-left' | 'bottom-left';
  front: StitchLens;
  back: StitchLens;
  pipeline: { seamLongitudesDeg: [number, number]; featherWidthPx: number };
}

export interface PanoramaFrameRendererOptions {
  projection: 'dual_fisheye' | 'equirect';
  dualFisheyeCalibration?: StitchCalibration;
  dualFisheyeFrontLens?: 'left' | 'right';
  dualFisheyeFovDeg?: number;
  dualFisheyeSeamBlendDeg?: number;
  dualFisheyeFlipX?: boolean;
  dualFisheyeFlipY?: boolean;
  dualFisheyeVideoProtection?: boolean;
  dualFisheyeVideoRegistration?: boolean;
  dualFisheyeRefineFocal?: boolean;
  equirectFlipX?: boolean;
  maxRenderPixelRatio?: number;
  minFovDeg?: number;
  maxFovDeg?: number;
}

export interface PanoramaFrameRenderer {
  presentFrames(frames: CanvasImageSource[], time: number, force?: boolean): number | undefined;
  setView(yaw: number, pitch: number, roll: number, fov: number): void;
  requestFrame(reason?: string): void;
  reset(): void;
  start(): void;
  destroy(): void;
}

