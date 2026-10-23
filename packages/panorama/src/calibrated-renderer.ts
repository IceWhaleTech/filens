import {
  DataTexture,
  LinearFilter,
  Mesh,
  RedFormat,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
  VideoFrameTexture,
  VideoTexture
} from 'three';
import {
  PanoramaProcessorError,
  panoramaDecoderConfig,
  panoramaEncodedVideoChunk,
  type PanoramaAssetManifest,
  type PanoramaInput,
  type PanoramaImuSample,
  type PanoramaLens,
  type PanoramaProcessor,
  type PanoramaVideoTrack
} from './wasm-processor';

export type PanoramaStabilizationMode = 'off' | 'camera' | 'horizon-lock';

export interface CalibratedPanoramaRenderer {
  mesh?: Mesh<SphereGeometry, ShaderMaterial>;
  canvas?: HTMLCanvasElement;
  dragDirectionSign?: number;
  setView?(yaw: number, pitch: number, roll: number, fov: number): void;
  requestRender?(): void;
  update(): void;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  close(): void;
  readonly duration: number;
  readonly currentTime: number;
  readonly paused: boolean;
  readonly streamSyncMs: number;
  readonly dynamicSeam: boolean;
  readonly stabilizationAvailable: boolean;
  readonly stabilizationMode: PanoramaStabilizationMode;
  readonly error?: Error;
  setStabilization(mode: PanoramaStabilizationMode): PanoramaStabilizationMode;
}

export interface PanoramaLensSource {
  track: PanoramaVideoTrack;
  rect: { x: number; y: number; width: number; height: number };
}

export async function createCalibratedPanoramaImageRenderer(processor: PanoramaProcessor, manifest: PanoramaAssetManifest, texture: Texture): Promise<CalibratedPanoramaRenderer> {
  if (manifest.projection.kind !== 'mei-extended' || !hasAccuratePanoramaCalibration(manifest)) {
    throw new PanoramaProcessorError('calibration_missing', 'This INSP does not contain two supported calibrated panorama lenses.');
  }
  const width = manifest.width ?? Number((texture.image as { naturalWidth?: number; width?: number } | undefined)?.naturalWidth ?? (texture.image as { width?: number } | undefined)?.width);
  const height = manifest.height ?? Number((texture.image as { naturalHeight?: number; height?: number } | undefined)?.naturalHeight ?? (texture.image as { height?: number } | undefined)?.height);
  if (!(width > 0) || !(height > 0)) throw new PanoramaProcessorError('invalid_manifest', 'The calibrated INSP image dimensions are unavailable.');
  const pseudoTrack: PanoramaVideoTrack = { id: 0, codec: 'jpeg', decoderConfig: '', width, height, timescale: 1, samples: [] };
  const lensSources = manifest.lenses.slice(0, 2).map((lens) => ({
    track: pseudoTrack,
    rect: lens.sourceRect ?? { x: 0, y: 0, width: 1, height: 1 }
  })) as [PanoramaLensSource, PanoramaLensSource];
  if (!lensSources.every((source) => validSourceRect(source.rect))) {
    throw new PanoramaProcessorError('invalid_manifest', 'The calibrated INSP lenses are not bound to valid image regions.');
  }

  texture.flipY = panoramaTextureFlipY(manifest.textureOrigin);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  const seamTexture = new DataTexture(new Uint8Array(128 * 64).fill(128), 128, 64, RedFormat, UnsignedByteType);
  seamTexture.needsUpdate = true;
  seamTexture.minFilter = LinearFilter;
  const material = createStillCalibratedMaterial(manifest, lensSources, texture, seamTexture);
  applyVendorDistortion(material, manifest.lenses);
  const geometry = new SphereGeometry(500, 96, 64);
  geometry.scale(-1, 1, 1);
  const mesh = new Mesh(geometry, material);
  const analyzer = new PanoramaFrameAnalyzer(processor, manifest, lensSources, material, seamTexture);
  analyzer.acceptImage(texture.image as CanvasImageSource);

  return {
    mesh,
    update: () => undefined,
    play: () => undefined,
    pause: () => undefined,
    seek: () => undefined,
    close: () => {
      analyzer.close();
      seamTexture.dispose();
      geometry.dispose();
      material.dispose();
    },
    duration: 0,
    currentTime: 0,
    paused: true,
    streamSyncMs: 0,
    get dynamicSeam() { return analyzer.active; },
    stabilizationAvailable: false,
    stabilizationMode: 'off',
    error: undefined,
    setStabilization: () => 'off'
  };
}

function createStillCalibratedMaterial(manifest: PanoramaAssetManifest, lensSources: [PanoramaLensSource, PanoramaLensSource], texture: Texture, seamTexture: DataTexture): ShaderMaterial {
  const lenses = manifest.lenses.slice(0, 2);
  return new ShaderMaterial({
    uniforms: {
      lens0: { value: texture },
      lens1: { value: texture },
      intrinsics0: { value: lensIntrinsics(lenses[0]) },
      intrinsics1: { value: lensIntrinsics(lenses[1]) },
      size0: { value: lensImageSize(lenses[0], lensSources[0]) },
      size1: { value: lensImageSize(lenses[1], lensSources[1]) },
      sourceRect0: { value: panoramaLensTextureRect(lensSources[0], manifest.textureOrigin) },
      sourceRect1: { value: panoramaLensTextureRect(lensSources[1], manifest.textureOrigin) },
      distortion0: { value: lensDistortion(lenses[0]) },
      distortion1: { value: lensDistortion(lenses[1]) },
      quaternion0: { value: lensQuaternion(lenses[0]) },
      quaternion1: { value: lensQuaternion(lenses[1]) },
      radialScale0: { value: radialScale(lenses[0]) },
      radialScale1: { value: radialScale(lenses[1]) },
      projectionKind: { value: 1 },
      xi0: { value: lenses[0].xi || 0 },
      xi1: { value: lenses[1].xi || 0 },
      tangential0: { value: lensPair(lenses[0].tangential) },
      tangential1: { value: lensPair(lenses[1].tangential) },
      thinPrism0: { value: lensFour(lenses[0].thinPrism) },
      thinPrism1: { value: lensFour(lenses[1].thinPrism) },
      sensorTilt0: { value: lensPair(lenses[0].sensorTilt) },
      sensorTilt1: { value: lensPair(lenses[1].sensorTilt) },
      seamMask: { value: seamTexture },
      useDynamicSeam: { value: 0 },
      exposureGain0: { value: [1, 1, 1] },
      exposureGain1: { value: [1, 1, 1] },
      stabilizationQuaternion: { value: [1, 0, 0, 0] }
    },
    vertexShader: `
      varying vec2 panoramaUv;
      void main() {
        panoramaUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 panoramaUv;
      uniform sampler2D lens0;
      uniform sampler2D lens1;
      uniform vec4 intrinsics0;
      uniform vec4 intrinsics1;
      uniform vec2 size0;
      uniform vec2 size1;
      uniform vec4 sourceRect0;
      uniform vec4 sourceRect1;
      uniform vec4 distortion0;
      uniform vec4 distortion1;
      uniform vec4 quaternion0;
      uniform vec4 quaternion1;
      uniform float radialScale0;
      uniform float radialScale1;
      uniform int projectionKind;
      uniform float xi0;
      uniform float xi1;
      uniform vec2 tangential0;
      uniform vec2 tangential1;
      uniform vec4 thinPrism0;
      uniform vec4 thinPrism1;
      uniform vec2 sensorTilt0;
      uniform vec2 sensorTilt1;
      uniform sampler2D seamMask;
      uniform int useDynamicSeam;
      uniform vec3 exposureGain0;
      uniform vec3 exposureGain1;
      uniform vec4 stabilizationQuaternion;

      vec3 rotateQuaternion(vec4 q, vec3 v) {
        vec3 u = q.yzw;
        return 2.0 * dot(u, v) * u + (q.x * q.x - dot(u, u)) * v + 2.0 * q.x * cross(u, v);
      }

      vec2 applySensorTilt(vec2 point, vec2 tilt) {
        float cx = cos(tilt.x), sx = sin(tilt.x);
        float cy = cos(tilt.y), sy = sin(tilt.y);
        float rx = cy*point.x + sy*sx*point.y - sy*cx;
        float ry = cx*point.y + sx;
        float rz = sy*point.x - cy*sx*point.y + cy*cx;
        float safeRz = abs(rz) > 0.000001 ? rz : (rz < 0.0 ? -0.000001 : 0.000001);
        return vec2(cx*(cy*rx + sy*rz), cy*cx*ry - sx*rz) / safeRz;
      }

      vec4 projectLens(vec3 body, vec4 intrinsics, vec2 imageSize, vec4 sourceRect, vec4 distortion, vec4 quaternion, float xi, vec2 tangential, vec4 thinPrism, vec2 sensorTilt, sampler2D image) {
        vec3 direction = rotateQuaternion(normalize(vec4(quaternion.x, -quaternion.yzw)), body);
        float denominator = direction.z + xi;
        vec2 normalized = direction.xy / max(denominator, 0.000001);
        float r2 = dot(normalized, normalized);
        if (denominator <= 0.000001 || r2 > 16.0) return vec4(0.0);
        float r4 = r2 * r2;
        float radialFactor = 1.0 + distortion.x*r2 + distortion.y*r4 + distortion.z*r2*r4 + distortion.w*r4*r4;
        float x = normalized.x;
        float y = normalized.y;
        vec2 distorted = vec2(
          x*radialFactor + 2.0*tangential.x*x*y + tangential.y*(r2 + 2.0*x*x) + thinPrism.x*r2 + thinPrism.y*r4,
          y*radialFactor + tangential.x*(r2 + 2.0*y*y) + 2.0*tangential.y*x*y + thinPrism.z*r2 + thinPrism.w*r4
        );
        vec2 pixel = intrinsics.zw + intrinsics.xy * applySensorTilt(distorted, sensorTilt);
        vec2 uv = sourceRect.xy + ((pixel + vec2(0.5)) / imageSize) * sourceRect.zw;
        float edgeRadius = 0.475 * min(imageSize.x, imageSize.y);
        float coverageDepth = max(edgeRadius - distance(pixel, intrinsics.zw), 0.0);
        float valid = float(direction.z + xi > 0.000001 && coverageDepth > 0.0)
          * float(all(greaterThanEqual(pixel, vec2(0.0))) && all(lessThanEqual(pixel, imageSize - vec2(1.0))));
        return vec4(texture2D(image, uv).rgb, valid * max(coverageDepth, 0.0001));
      }

      vec2 panoramaUvForDirection(vec3 direction) {
        float longitude = atan(direction.x, direction.z);
        float latitude = asin(clamp(-direction.y, -1.0, 1.0));
        return vec2(fract(longitude / 6.28318530718 + 0.5), latitude / 3.14159265359 + 0.5);
      }

      void main() {
        float longitude = panoramaUv.x * 6.28318530718 - 3.14159265359;
        float latitude = (panoramaUv.y - 0.5) * 3.14159265359;
        float cosLatitude = cos(latitude);
        vec3 body = vec3(cosLatitude * sin(longitude), -sin(latitude), cosLatitude * cos(longitude));
        body = rotateQuaternion(normalize(stabilizationQuaternion), body);
        vec2 bodyPanoramaUv = panoramaUvForDirection(body);
        vec4 a = projectLens(body, intrinsics0, size0, sourceRect0, distortion0, quaternion0, xi0, tangential0, thinPrism0, sensorTilt0, lens0);
        vec4 b = projectLens(body, intrinsics1, size1, sourceRect1, distortion1, quaternion1, xi1, tangential1, thinPrism1, sensorTilt1, lens1);
        if (a.a <= 0.0 && b.a <= 0.0) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          return;
        }
        if (a.a <= 0.0 || b.a <= 0.0) {
          gl_FragColor = vec4((a.a > 0.0 ? a.rgb * exposureGain0 : b.rgb * exposureGain1), 1.0);
          return;
        }
        float frontPreference = 1.0 - smoothstep(radians(75.0), radians(105.0), abs(bodyPanoramaUv.x * 6.28318530718 - 3.14159265359));
        float aWeight = a.a * frontPreference;
        float bWeight = b.a * (1.0 - frontPreference);
        float lens1Weight = useDynamicSeam == 1
          ? texture2D(seamMask, bodyPanoramaUv).r
          : bWeight / max(aWeight + bWeight, 0.0001);
        gl_FragColor = vec4(mix(a.rgb * exposureGain0, b.rgb * exposureGain1, lens1Weight), 1.0);
      }
    `
  });
}

export async function createCalibratedPanoramaRenderer(processor: PanoramaProcessor, manifest: PanoramaAssetManifest): Promise<CalibratedPanoramaRenderer> {
  if (!['dji-fisheye-lut', 'mei-extended'].includes(manifest.projection.kind) || manifest.lenses.length < 2) {
    throw new PanoramaProcessorError('calibration_missing', 'This source does not contain two supported calibrated panorama lenses.');
  }
  if (!hasAccuratePanoramaCalibration(manifest)) {
    throw new PanoramaProcessorError('calibration_missing', 'The two panorama lenses do not contain complete, distinct calibration.');
  }
  if (typeof VideoDecoder === 'undefined' || typeof EncodedVideoChunk === 'undefined') {
    throw new PanoramaProcessorError('codec_unsupported', 'This browser does not expose WebCodecs video decoding.');
  }
  const lensSources = resolvePanoramaLensSources(manifest);
  if (!lensSources) {
    throw new PanoramaProcessorError('invalid_manifest', 'The panorama lenses are not bound to valid source tracks and frame regions.');
  }
  const tracks = [...new Map(lensSources.map((source) => [source.track.id, source.track])).values()];
  if (tracks.some((track) => track.timescale <= 0 || !track.samples.length)) {
    throw new PanoramaProcessorError('invalid_manifest', 'The calibrated panorama tracks do not contain a playable sample timeline.');
  }
  const configs = tracks.map(panoramaDecoderConfig);
  const support = await Promise.all(configs.map((config) => VideoDecoder.isConfigSupported(config)));
  if (support.some((item) => !item.supported)) {
    throw new PanoramaProcessorError('codec_unsupported', `This browser cannot decode the ${[...new Set(tracks.map((track) => track.codec.toUpperCase()))].join('/')} panorama tracks.`);
  }

  const textures = tracks.map(() => new VideoFrameTexture());
  textures.forEach((texture) => {
    texture.flipY = panoramaTextureFlipY(manifest.textureOrigin);
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearFilter;
  });
  const seamTexture = new DataTexture(new Uint8Array(128 * 64).fill(128), 128, 64, RedFormat, UnsignedByteType);
  seamTexture.needsUpdate = true;
  seamTexture.minFilter = LinearFilter;
  const lenses = manifest.lenses.slice(0, 2);
  const lensTextures = lensSources.map((source) => textures[tracks.indexOf(source.track)]);
  const material = new ShaderMaterial({
    uniforms: {
      lens0: { value: lensTextures[0] },
      lens1: { value: lensTextures[1] },
      intrinsics0: { value: lensIntrinsics(lenses[0]) },
      intrinsics1: { value: lensIntrinsics(lenses[1]) },
      size0: { value: lensImageSize(lenses[0], lensSources[0]) },
      size1: { value: lensImageSize(lenses[1], lensSources[1]) },
      sourceRect0: { value: panoramaLensTextureRect(lensSources[0], manifest.textureOrigin) },
      sourceRect1: { value: panoramaLensTextureRect(lensSources[1], manifest.textureOrigin) },
      distortion0: { value: lensDistortion(lenses[0]) },
      distortion1: { value: lensDistortion(lenses[1]) },
      quaternion0: { value: lensQuaternion(lenses[0]) },
      quaternion1: { value: lensQuaternion(lenses[1]) },
      radialScale0: { value: radialScale(lenses[0]) },
      radialScale1: { value: radialScale(lenses[1]) },
      projectionKind: { value: manifest.projection.kind === 'mei-extended' ? 1 : 0 },
      xi0: { value: lenses[0].xi || 0 },
      xi1: { value: lenses[1].xi || 0 },
      tangential0: { value: lensPair(lenses[0].tangential) },
      tangential1: { value: lensPair(lenses[1].tangential) },
      thinPrism0: { value: lensFour(lenses[0].thinPrism) },
      thinPrism1: { value: lensFour(lenses[1].thinPrism) },
      sensorTilt0: { value: lensPair(lenses[0].sensorTilt) },
      sensorTilt1: { value: lensPair(lenses[1].sensorTilt) },
      seamMask: { value: seamTexture },
      useDynamicSeam: { value: 0 },
      exposureGain0: { value: [1, 1, 1] },
      exposureGain1: { value: [1, 1, 1] },
      stabilizationQuaternion: { value: [1, 0, 0, 0] }
    },
    vertexShader: `
      varying vec2 panoramaUv;
      void main() {
        panoramaUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 panoramaUv;
      uniform sampler2D lens0;
      uniform sampler2D lens1;
      uniform vec4 intrinsics0;
      uniform vec4 intrinsics1;
      uniform vec2 size0;
      uniform vec2 size1;
      uniform vec4 sourceRect0;
      uniform vec4 sourceRect1;
      uniform vec4 distortion0;
      uniform vec4 distortion1;
      uniform vec4 quaternion0;
      uniform vec4 quaternion1;
      uniform float radialScale0;
      uniform float radialScale1;
      uniform int projectionKind;
      uniform float xi0;
      uniform float xi1;
      uniform vec2 tangential0;
      uniform vec2 tangential1;
      uniform vec4 thinPrism0;
      uniform vec4 thinPrism1;
      uniform vec2 sensorTilt0;
      uniform vec2 sensorTilt1;
      uniform sampler2D seamMask;
      uniform int useDynamicSeam;
      uniform vec3 exposureGain0;
      uniform vec3 exposureGain1;
      uniform vec4 stabilizationQuaternion;

      vec3 rotateQuaternion(vec4 q, vec3 v) {
        vec3 u = q.yzw;
        return 2.0 * dot(u, v) * u + (q.x * q.x - dot(u, u)) * v + 2.0 * q.x * cross(u, v);
      }

      float radial(float theta, vec4 k, float scale, float fx) {
        float limit = radians(85.0);
        float t = min(theta, limit);
        float t2 = t * t;
        float polynomial = t * (1.0 + k.x*t2 + k.y*t2*t2 + k.z*t2*t2*t2 + k.w*t2*t2*t2*t2);
        if (theta > limit) {
          float derivative = 1.0 + 3.0*k.x*t2 + 5.0*k.y*t2*t2 + 7.0*k.z*t2*t2*t2 + 9.0*k.w*t2*t2*t2*t2;
          polynomial += derivative * (theta - limit);
        }
        return scale * fx * polynomial;
      }

      vec2 applySensorTilt(vec2 point, vec2 tilt) {
        float cx = cos(tilt.x), sx = sin(tilt.x);
        float cy = cos(tilt.y), sy = sin(tilt.y);
        float rx = cy*point.x + sy*sx*point.y - sy*cx;
        float ry = cx*point.y + sx;
        float rz = sy*point.x - cy*sx*point.y + cy*cx;
        float safeRz = abs(rz) > 0.000001 ? rz : (rz < 0.0 ? -0.000001 : 0.000001);
        return vec2(cx*(cy*rx + sy*rz), cy*cx*ry - sx*rz) / safeRz;
      }

      vec4 projectLens(vec3 body, vec4 intrinsics, vec2 imageSize, vec4 sourceRect, vec4 distortion, vec4 quaternion, float scale, float xi, vec2 tangential, vec4 thinPrism, vec2 sensorTilt, sampler2D image) {
        vec4 lensQuaternion = projectionKind == 1 ? vec4(quaternion.x, -quaternion.yzw) : quaternion;
        vec3 direction = rotateQuaternion(normalize(lensQuaternion), body);
        float theta = acos(clamp(direction.z, -1.0, 1.0));
        vec2 pixel;
        if (projectionKind == 1) {
          float denominator = direction.z + xi;
          vec2 normalized = direction.xy / max(denominator, 0.000001);
          float r2 = dot(normalized, normalized);
          if (denominator <= 0.000001 || r2 > 16.0) return vec4(0.0);
          float r4 = r2 * r2;
          float radialFactor = 1.0 + distortion.x*r2 + distortion.y*r4 + distortion.z*r2*r4 + distortion.w*r4*r4;
          float x = normalized.x;
          float y = normalized.y;
          vec2 distorted = vec2(
            x*radialFactor + 2.0*tangential.x*x*y + tangential.y*(r2 + 2.0*x*x) + thinPrism.x*r2 + thinPrism.y*r4,
            y*radialFactor + tangential.x*(r2 + 2.0*y*y) + 2.0*tangential.y*x*y + thinPrism.z*r2 + thinPrism.w*r4
          );
          pixel = intrinsics.zw + intrinsics.xy * applySensorTilt(distorted, sensorTilt);
        } else {
          float rho = max(length(direction.xy), 0.000001);
          float radius = radial(theta, distortion, scale, intrinsics.x);
          pixel = intrinsics.zw + radius * direction.xy / rho;
        }
        vec2 uv = sourceRect.xy + ((pixel + vec2(0.5)) / imageSize) * sourceRect.zw;
        float validProjection = projectionKind == 1 ? float(direction.z + xi > 0.000001) : float(theta < radians(96.0));
        float coverageDepth = 1.0;
        if (projectionKind == 1) {
          float edgeRadius = 0.475 * min(imageSize.x, imageSize.y);
          coverageDepth = max(edgeRadius - distance(pixel, intrinsics.zw), 0.0);
          validProjection *= float(coverageDepth > 0.0);
        }
        float valid = validProjection * float(all(greaterThanEqual(pixel, vec2(0.0))) && all(lessThanEqual(pixel, imageSize - vec2(1.0))));
        float weight = projectionKind == 1
          ? valid * max(coverageDepth, 0.0001)
          : valid * clamp((radians(95.0) - theta) / radians(10.0), 0.0, 1.0);
        return vec4(texture2D(image, uv).rgb, weight);
      }

      vec2 panoramaUvForDirection(vec3 direction) {
        float longitude = projectionKind == 1 ? atan(direction.x, direction.z) : atan(-direction.y, direction.x);
        float latitude = projectionKind == 1 ? asin(clamp(-direction.y, -1.0, 1.0)) : asin(clamp(direction.z, -1.0, 1.0));
        return vec2(fract(longitude / 6.28318530718 + 0.5), latitude / 3.14159265359 + 0.5);
      }

      void main() {
        float longitude = panoramaUv.x * 6.28318530718 - 3.14159265359;
        float latitude = (panoramaUv.y - 0.5) * 3.14159265359;
        float cosLatitude = cos(latitude);
        vec3 body = projectionKind == 1
          ? vec3(cosLatitude * sin(longitude), -sin(latitude), cosLatitude * cos(longitude))
          : vec3(cosLatitude * sin(longitude + 1.57079632679), cosLatitude * cos(longitude + 1.57079632679), sin(latitude));
        body = rotateQuaternion(normalize(stabilizationQuaternion), body);
        vec2 bodyPanoramaUv = panoramaUvForDirection(body);
        vec4 a = projectLens(body, intrinsics0, size0, sourceRect0, distortion0, quaternion0, radialScale0, xi0, tangential0, thinPrism0, sensorTilt0, lens0);
        vec4 b = projectLens(body, intrinsics1, size1, sourceRect1, distortion1, quaternion1, radialScale1, xi1, tangential1, thinPrism1, sensorTilt1, lens1);
        if (a.a <= 0.0 && b.a <= 0.0) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          return;
        }
        if (a.a <= 0.0 || b.a <= 0.0) {
          gl_FragColor = vec4((a.a > 0.0 ? a.rgb * exposureGain0 : b.rgb * exposureGain1), 1.0);
          return;
        }
        float frontPreference = projectionKind == 1
          ? 1.0 - smoothstep(radians(75.0), radians(105.0), abs(bodyPanoramaUv.x * 6.28318530718 - 3.14159265359))
          : 1.0;
        float aWeight = projectionKind == 1 ? a.a * frontPreference : a.a;
        float bWeight = projectionKind == 1 ? b.a * (1.0 - frontPreference) : b.a;
        float total = aWeight + bWeight;
        float lens1Weight = useDynamicSeam == 1 && a.a > 0.0 && b.a > 0.0
          ? texture2D(seamMask, bodyPanoramaUv).r
          : bWeight / max(total, 0.0001);
        gl_FragColor = vec4(mix(a.rgb * exposureGain0, b.rgb * exposureGain1, lens1Weight), 1.0);
      }
    `
  });
  applyVendorDistortion(material, manifest.lenses);
  const geometry = new SphereGeometry(500, 96, 64);
  geometry.scale(-1, 1, 1);
  const mesh = new Mesh(geometry, material);
  const analyzer = new PanoramaFrameAnalyzer(processor, manifest, lensSources, material, seamTexture);
  const stabilizer = new ImuStabilizer(processor, manifest, material);
  const playback = new DualTrackPlayback(processor, tracks, textures, configs, (first, second) => {
    stabilizer.apply(first.timestamp / 1_000_000);
    analyzer.accept(first, second);
  }, (seconds) => stabilizer.prepare(seconds), () => {
    analyzer.reset();
    stabilizer.reset();
  });
  playback.start();
  return {
    mesh,
    update: () => playback.update(),
    play: () => playback.play(),
    pause: () => playback.pause(),
    seek: (seconds) => playback.seek(seconds),
    close: () => {
      playback.close();
      analyzer.close();
      textures.forEach((texture) => texture.dispose());
      seamTexture.dispose();
      geometry.dispose();
      material.dispose();
    },
    get streamSyncMs() { return playback.streamSyncMs; },
    get dynamicSeam() { return analyzer.active; },
    get duration() { return playback.duration; },
    get currentTime() { return playback.currentTime; },
    get paused() { return playback.paused; },
    get stabilizationAvailable() { return stabilizer.available; },
    get stabilizationMode() { return stabilizer.mode; },
    get error() { return playback.error; },
    setStabilization: (mode) => stabilizer.setMode(mode)
  };
}

/**
 * Render calibrated tracks through HTML media when WebCodecs is unavailable.
 * This keeps raw INSV useful on browsers such as Safari while retaining the
 * calibrated GPU projection. Dynamic seam analysis and IMU stabilization are
 * intentionally disabled because those require decoded VideoFrame objects.
 */
export async function createBrowserCalibratedPanoramaRenderer(
  manifest: PanoramaAssetManifest,
  source: PanoramaInput,
  companion?: PanoramaInput
): Promise<CalibratedPanoramaRenderer> {
  if (!['dji-fisheye-lut', 'mei-extended'].includes(manifest.projection.kind) || manifest.lenses.length < 2) {
    throw new PanoramaProcessorError('calibration_missing', 'This source does not contain two supported calibrated panorama lenses.');
  }
  if (!hasAccuratePanoramaCalibration(manifest)) {
    throw new PanoramaProcessorError('calibration_missing', 'The two panorama lenses do not contain complete, distinct calibration.');
  }
  const lensSources = resolvePanoramaLensSources(manifest);
  if (!lensSources) {
    throw new PanoramaProcessorError('invalid_manifest', 'The panorama lenses are not bound to valid source tracks and frame regions.');
  }
  const tracks = [...new Map(lensSources.map((item) => [item.track.id, item.track])).values()];
  if (tracks.some((track) => track.timescale <= 0 || !track.samples.length)) {
    throw new PanoramaProcessorError('invalid_manifest', 'The calibrated panorama tracks do not contain a playable sample timeline.');
  }

  const inputByTrack = new Map<number, PanoramaInput>();
  for (const lensSource of lensSources) {
    if (inputByTrack.has(lensSource.track.id)) continue;
    // Companion files contain the second physical lens. Packed tracks stay in
    // the primary source and therefore use the same media element.
    inputByTrack.set(lensSource.track.id, inputByTrack.size === 0 || !companion ? source : companion);
  }
  const media = tracks.map((track) => createBrowserCalibratedPanoramaVideo(inputByTrack.get(track.id) ?? source));
  try {
    await Promise.all(media.map((video) => waitForBrowserPanoramaVideo(video)));
  } catch (error) {
    media.forEach((video) => video.remove());
    media.forEach((video) => revokeBrowserPanoramaVideo(video));
    throw new PanoramaProcessorError('codec_unsupported', error instanceof Error ? error.message : String(error));
  }

  const textures = media.map((video) => {
    const texture = new VideoTexture(video);
    texture.flipY = panoramaTextureFlipY(manifest.textureOrigin);
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearFilter;
    return texture;
  });
  const seamTexture = new DataTexture(new Uint8Array(128 * 64).fill(128), 128, 64, RedFormat, UnsignedByteType);
  seamTexture.needsUpdate = true;
  seamTexture.minFilter = LinearFilter;
  const lenses = manifest.lenses.slice(0, 2);
  const lensTextures = lensSources.map((item) => textures[tracks.indexOf(item.track)]);
  const material = createBrowserCalibratedMaterial(manifest, lenses as [PanoramaLens, PanoramaLens], lensSources, lensTextures as unknown as [Texture, Texture], seamTexture);
  applyVendorDistortion(material, manifest.lenses);
  const geometry = new SphereGeometry(500, 96, 64);
  geometry.scale(-1, 1, 1);
  const mesh = new Mesh(geometry, material);
  const playback = new BrowserPanoramaPlayback(media, textures);
  playback.play();
  return {
    mesh,
    update: () => playback.update(),
    play: () => playback.play(),
    pause: () => playback.pause(),
    seek: (seconds) => playback.seek(seconds),
    close: () => {
      playback.close();
      seamTexture.dispose();
      textures.forEach((texture) => texture.dispose());
      geometry.dispose();
      material.dispose();
      media.forEach((video) => {
        video.remove();
        revokeBrowserPanoramaVideo(video);
      });
    },
    get duration() { return playback.duration; },
    get currentTime() { return playback.currentTime; },
    get paused() { return playback.paused; },
    streamSyncMs: 0,
    dynamicSeam: false,
    stabilizationAvailable: false,
    stabilizationMode: 'off',
    error: undefined,
    setStabilization: () => 'off'
  };
}

function createBrowserCalibratedPanoramaVideo(source: PanoramaInput): HTMLVideoElement {
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.setAttribute('aria-hidden', 'true');
  video.style.display = 'none';
  if (typeof source === 'string' || source instanceof URL) {
    video.src = String(source);
  } else {
    const bytes = source instanceof Blob ? source : new Blob([browserPanoramaSourceBytes(source)], { type: 'video/mp4' });
    const url = URL.createObjectURL(bytes);
    browserPanoramaVideoUrls.set(video, url);
    video.src = url;
  }
  document.body?.append(video);
  video.load();
  return video;
}

function browserPanoramaSourceBytes(source: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (source instanceof ArrayBuffer) return source;
  const view = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

const browserPanoramaVideoUrls = new WeakMap<HTMLVideoElement, string>();

function waitForBrowserPanoramaVideo(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    video.addEventListener('loadeddata', () => resolve(), { once: true });
    video.addEventListener('error', () => reject(new Error('The browser could not decode the calibrated INSV video track.')), { once: true });
  });
}

function revokeBrowserPanoramaVideo(video: HTMLVideoElement): void {
  const url = browserPanoramaVideoUrls.get(video);
  if (url) {
    URL.revokeObjectURL(url);
    browserPanoramaVideoUrls.delete(video);
  }
}

function createBrowserCalibratedMaterial(
  manifest: PanoramaAssetManifest,
  lenses: [PanoramaLens, PanoramaLens],
  lensSources: [PanoramaLensSource, PanoramaLensSource],
  lensTextures: [Texture, Texture],
  seamTexture: DataTexture
): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      lens0: { value: lensTextures[0] },
      lens1: { value: lensTextures[1] },
      intrinsics0: { value: lensIntrinsics(lenses[0]) },
      intrinsics1: { value: lensIntrinsics(lenses[1]) },
      size0: { value: lensImageSize(lenses[0], lensSources[0]) },
      size1: { value: lensImageSize(lenses[1], lensSources[1]) },
      sourceRect0: { value: panoramaLensTextureRect(lensSources[0], manifest.textureOrigin) },
      sourceRect1: { value: panoramaLensTextureRect(lensSources[1], manifest.textureOrigin) },
      distortion0: { value: lensDistortion(lenses[0]) },
      distortion1: { value: lensDistortion(lenses[1]) },
      quaternion0: { value: lensQuaternion(lenses[0]) },
      quaternion1: { value: lensQuaternion(lenses[1]) },
      radialScale0: { value: radialScale(lenses[0]) },
      radialScale1: { value: radialScale(lenses[1]) },
      projectionKind: { value: manifest.projection.kind === 'mei-extended' ? 1 : 0 },
      xi0: { value: lenses[0].xi || 0 },
      xi1: { value: lenses[1].xi || 0 },
      tangential0: { value: lensPair(lenses[0].tangential) },
      tangential1: { value: lensPair(lenses[1].tangential) },
      thinPrism0: { value: lensFour(lenses[0].thinPrism) },
      thinPrism1: { value: lensFour(lenses[1].thinPrism) },
      sensorTilt0: { value: lensPair(lenses[0].sensorTilt) },
      sensorTilt1: { value: lensPair(lenses[1].sensorTilt) },
      seamMask: { value: seamTexture },
      useDynamicSeam: { value: 0 },
      exposureGain0: { value: [1, 1, 1] },
      exposureGain1: { value: [1, 1, 1] },
      stabilizationQuaternion: { value: [1, 0, 0, 0] }
    },
    vertexShader: `
      varying vec2 panoramaUv;
      void main() {
        panoramaUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 panoramaUv;
      uniform sampler2D lens0;
      uniform sampler2D lens1;
      uniform vec4 intrinsics0;
      uniform vec4 intrinsics1;
      uniform vec2 size0;
      uniform vec2 size1;
      uniform vec4 sourceRect0;
      uniform vec4 sourceRect1;
      uniform vec4 distortion0;
      uniform vec4 distortion1;
      uniform vec4 quaternion0;
      uniform vec4 quaternion1;
      uniform float radialScale0;
      uniform float radialScale1;
      uniform int projectionKind;
      uniform float xi0;
      uniform float xi1;
      uniform vec2 tangential0;
      uniform vec2 tangential1;
      uniform vec4 thinPrism0;
      uniform vec4 thinPrism1;
      uniform vec2 sensorTilt0;
      uniform vec2 sensorTilt1;
      uniform sampler2D seamMask;
      uniform int useDynamicSeam;
      uniform vec3 exposureGain0;
      uniform vec3 exposureGain1;
      uniform vec4 stabilizationQuaternion;

      vec3 rotateQuaternion(vec4 q, vec3 v) {
        vec3 u = q.yzw;
        return 2.0 * dot(u, v) * u + (q.x * q.x - dot(u, u)) * v + 2.0 * q.x * cross(u, v);
      }

      float radial(float theta, vec4 k, float scale, float fx) {
        float limit = radians(85.0);
        float t = min(theta, limit);
        float t2 = t * t;
        float polynomial = t * (1.0 + k.x*t2 + k.y*t2*t2 + k.z*t2*t2*t2 + k.w*t2*t2*t2*t2);
        if (theta > limit) {
          float derivative = 1.0 + 3.0*k.x*t2 + 5.0*k.y*t2*t2 + 7.0*k.z*t2*t2*t2 + 9.0*k.w*t2*t2*t2*t2;
          polynomial += derivative * (theta - limit);
        }
        return scale * fx * polynomial;
      }

      vec2 applySensorTilt(vec2 point, vec2 tilt) {
        float cx = cos(tilt.x), sx = sin(tilt.x);
        float cy = cos(tilt.y), sy = sin(tilt.y);
        float rx = cy*point.x + sy*sx*point.y - sy*cx;
        float ry = cx*point.y + sx;
        float rz = sy*point.x - cy*sx*point.y + cy*cx;
        float safeRz = abs(rz) > 0.000001 ? rz : (rz < 0.0 ? -0.000001 : 0.000001);
        return vec2(cx*(cy*rx + sy*rz), cy*cx*ry - sx*rz) / safeRz;
      }

      vec4 projectLens(vec3 body, vec4 intrinsics, vec2 imageSize, vec4 sourceRect, vec4 distortion, vec4 quaternion, float scale, float xi, vec2 tangential, vec4 thinPrism, vec2 sensorTilt, sampler2D image) {
        vec4 lensQuaternion = projectionKind == 1 ? vec4(quaternion.x, -quaternion.yzw) : quaternion;
        vec3 direction = rotateQuaternion(normalize(lensQuaternion), body);
        float theta = acos(clamp(direction.z, -1.0, 1.0));
        vec2 pixel;
        if (projectionKind == 1) {
          float denominator = direction.z + xi;
          vec2 normalized = direction.xy / max(denominator, 0.000001);
          float r2 = dot(normalized, normalized);
          if (denominator <= 0.000001 || r2 > 16.0) return vec4(0.0);
          float r4 = r2 * r2;
          float radialFactor = 1.0 + distortion.x*r2 + distortion.y*r4 + distortion.z*r2*r4 + distortion.w*r4*r4;
          float x = normalized.x;
          float y = normalized.y;
          vec2 distorted = vec2(
            x*radialFactor + 2.0*tangential.x*x*y + tangential.y*(r2 + 2.0*x*x) + thinPrism.x*r2 + thinPrism.y*r4,
            y*radialFactor + tangential.x*(r2 + 2.0*y*y) + 2.0*tangential.y*x*y + thinPrism.z*r2 + thinPrism.w*r4
          );
          pixel = intrinsics.zw + intrinsics.xy * applySensorTilt(distorted, sensorTilt);
        } else {
          float rho = max(length(direction.xy), 0.000001);
          float radius = radial(theta, distortion, scale, intrinsics.x);
          pixel = intrinsics.zw + radius * direction.xy / rho;
        }
        vec2 uv = sourceRect.xy + ((pixel + vec2(0.5)) / imageSize) * sourceRect.zw;
        float validProjection = projectionKind == 1 ? float(direction.z + xi > 0.000001) : float(theta < radians(96.0));
        float coverageDepth = 1.0;
        if (projectionKind == 1) {
          float edgeRadius = 0.475 * min(imageSize.x, imageSize.y);
          coverageDepth = max(edgeRadius - distance(pixel, intrinsics.zw), 0.0);
          validProjection *= float(coverageDepth > 0.0);
        }
        float valid = validProjection * float(all(greaterThanEqual(pixel, vec2(0.0))) && all(lessThanEqual(pixel, imageSize - vec2(1.0))));
        float weight = projectionKind == 1
          ? valid * max(coverageDepth, 0.0001)
          : valid * clamp((radians(95.0) - theta) / radians(10.0), 0.0, 1.0);
        return vec4(texture2D(image, uv).rgb, weight);
      }

      vec2 panoramaUvForDirection(vec3 direction) {
        float longitude = projectionKind == 1 ? atan(direction.x, direction.z) : atan(-direction.y, direction.x);
        float latitude = projectionKind == 1 ? asin(clamp(-direction.y, -1.0, 1.0)) : asin(clamp(direction.z, -1.0, 1.0));
        return vec2(fract(longitude / 6.28318530718 + 0.5), latitude / 3.14159265359 + 0.5);
      }

      void main() {
        float longitude = panoramaUv.x * 6.28318530718 - 3.14159265359;
        float latitude = (panoramaUv.y - 0.5) * 3.14159265359;
        float cosLatitude = cos(latitude);
        vec3 body = projectionKind == 1
          ? vec3(cosLatitude * sin(longitude), -sin(latitude), cosLatitude * cos(longitude))
          : vec3(cosLatitude * sin(longitude + 1.57079632679), cosLatitude * cos(longitude + 1.57079632679), sin(latitude));
        body = rotateQuaternion(normalize(stabilizationQuaternion), body);
        vec2 bodyPanoramaUv = panoramaUvForDirection(body);
        vec4 a = projectLens(body, intrinsics0, size0, sourceRect0, distortion0, quaternion0, radialScale0, xi0, tangential0, thinPrism0, sensorTilt0, lens0);
        vec4 b = projectLens(body, intrinsics1, size1, sourceRect1, distortion1, quaternion1, radialScale1, xi1, tangential1, thinPrism1, sensorTilt1, lens1);
        if (a.a <= 0.0 && b.a <= 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        if (a.a <= 0.0 || b.a <= 0.0) { gl_FragColor = vec4((a.a > 0.0 ? a.rgb * exposureGain0 : b.rgb * exposureGain1), 1.0); return; }
        float frontPreference = projectionKind == 1
          ? 1.0 - smoothstep(radians(75.0), radians(105.0), abs(bodyPanoramaUv.x * 6.28318530718 - 3.14159265359))
          : 1.0;
        float aWeight = projectionKind == 1 ? a.a * frontPreference : a.a;
        float bWeight = projectionKind == 1 ? b.a * (1.0 - frontPreference) : b.a;
        float total = aWeight + bWeight;
        float lens1Weight = useDynamicSeam == 1 && a.a > 0.0 && b.a > 0.0 ? texture2D(seamMask, bodyPanoramaUv).r : bWeight / max(total, 0.0001);
        gl_FragColor = vec4(mix(a.rgb * exposureGain0, b.rgb * exposureGain1, lens1Weight), 1.0);
      }
    `
  });
}

class BrowserPanoramaPlayback {
  private isClosed = false;
  constructor(private readonly videos: HTMLVideoElement[], private readonly textures: VideoTexture[]) {}

  get duration(): number {
    const durations = this.videos.map((video) => video.duration).filter(Number.isFinite);
    return durations.length ? Math.min(...durations) : 0;
  }

  get currentTime(): number { return this.videos[0]?.currentTime || 0; }
  get paused(): boolean { return this.videos[0]?.paused ?? true; }

  update(): void {
    if (this.isClosed) return;
    if (this.videos.length >= 2 && !this.paused) {
      const target = this.currentTime;
      this.videos.slice(1).forEach((video) => {
        if (Math.abs(video.currentTime - target) > 0.05) video.currentTime = target;
      });
    }
    this.textures.forEach((texture) => texture.needsUpdate = true);
  }

  play(): void {
    if (this.isClosed) return;
    this.videos.forEach((video) => { void video.play().catch(() => undefined); });
  }

  pause(): void { this.videos.forEach((video) => video.pause()); }

  seek(seconds: number): void {
    const target = Math.max(0, Math.min(Number.isFinite(seconds) ? seconds : 0, this.duration));
    this.videos.forEach((video) => { video.currentTime = target; });
  }

  close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.pause();
  }
}

export function hasAccuratePanoramaCalibration(manifest: PanoramaAssetManifest): boolean {
  const lenses = manifest.lenses.slice(0, 2);
  if (lenses.length < 2 || !lenses.every((lens) => hasAccurateLensCalibration(lens, manifest.projection.kind))) return false;
  const model = (manifest.cameraModel || '').replace(/^Insta360\s+/i, '').trim().toUpperCase();
  if (model === 'X5' && (!['embedded', 'sidecar'].includes(manifest.calibrationSource)
    || !lenses.every((lens) => lens.distortionModel === 'radtan_pro'
      ? validNumbers(lens.distortionCoeffs, 13)
      : validNumbers(lens.thinPrism, 4) && validNumbers(lens.sensorTilt, 2)))) return false;
  const first = normalizeQuaternion(lenses[0].extrinsicQuaternion as number[]);
  const second = normalizeQuaternion(lenses[1].extrinsicQuaternion as number[]);
  if (Math.abs(first.reduce((sum, value, index) => sum + value * second[index], 0)) >= 0.999) return false;
  const firstAxis = lensOpticalAxis(lenses[0], manifest.projection.kind);
  const secondAxis = lensOpticalAxis(lenses[1], manifest.projection.kind);
  return firstAxis.reduce((sum, value, index) => sum + value * secondAxis[index], 0) < -0.8;
}

export function resolvePanoramaLensSources(manifest: PanoramaAssetManifest): [PanoramaLensSource, PanoramaLensSource] | undefined {
  const lenses = manifest.lenses.slice(0, 2);
  if (lenses.length < 2) return undefined;
  const sources = lenses.map((lens, index) => {
    const track = lens.sourceTrackId === undefined
      ? (manifest.tracks.length >= 2 ? manifest.tracks[index] : undefined)
      : manifest.tracks.find((candidate) => candidate.id === lens.sourceTrackId);
    const rect = lens.sourceRect ?? { x: 0, y: 0, width: 1, height: 1 };
    return track && validSourceRect(rect) ? { track, rect } : undefined;
  });
  if (!sources[0] || !sources[1]) return undefined;
  if (sources[0].track.id === sources[1].track.id && !lenses.every((lens) => lens.sourceRect)) return undefined;
  return sources as [PanoramaLensSource, PanoramaLensSource];
}

export function panoramaLensSourceUv(u: number, v: number, source: PanoramaLensSource, origin: PanoramaAssetManifest['textureOrigin']): [number, number] {
  return [
    source.rect.x + u * source.rect.width,
    source.rect.y + panoramaFrameSampleV(v, origin) * source.rect.height
  ];
}

export function panoramaLensTextureRect(source: PanoramaLensSource, origin: PanoramaAssetManifest['textureOrigin']): number[] {
  const { x, y, width, height } = source.rect;
  return [x, origin === 'top-left' ? y : 1 - y - height, width, height];
}

function validSourceRect(rect: PanoramaLensSource['rect']): boolean {
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0
    && rect.x + rect.width <= 1 && rect.y + rect.height <= 1;
}

function lensImageSize(lens: PanoramaLens, source: PanoramaLensSource): number[] {
  return [lens.width || source.track.width * source.rect.width, lens.height || source.track.height * source.rect.height];
}

export function lensOpticalAxis(lens: PanoramaLens, projection: PanoramaAssetManifest['projection']['kind']): Vec3 {
  const quaternion = lensQuaternion(lens);
  return rotateCpu(projection === 'mei-extended' ? quaternion : conjugateQuaternion(quaternion), [0, 0, 1]);
}

function hasAccurateLensCalibration(lens: PanoramaLens, projection: PanoramaAssetManifest['projection']['kind']): boolean {
  const scalars = [lens.width, lens.height, lens.fx, lens.fy, lens.cx, lens.cy];
  const quaternion = lens.extrinsicQuaternion;
  if (!scalars.every((value) => typeof value === 'number' && Number.isFinite(value))
    || ![lens.width, lens.height, lens.fx, lens.fy].every((value) => Number(value) > 0)
    || Number(lens.cx) < 0 || Number(lens.cx) >= Number(lens.width)
    || Number(lens.cy) < 0 || Number(lens.cy) >= Number(lens.height)
    || quaternion?.length !== 4 || !quaternion.every(Number.isFinite) || Math.hypot(...quaternion) < 0.5) return false;
  if (projection === 'dji-fisheye-lut') {
    return validNumbers(lens.distortion, 4) && validNumbers(lens.radialLut1, 14) && validNumbers(lens.radialLut2, 14);
  }
  if (lens.distortionModel === 'radtan_pro' && !validNumbers(lens.distortionCoeffs, 13)) return false;
  return projection === 'mei-extended' && Number.isFinite(lens.xi) && Number(lens.xi) > 0
    && validNumbers(lens.radial, 4) && validNumbers(lens.tangential, 2);
}

function validNumbers(values: Array<number | null> | undefined, count: number): boolean {
  return Boolean(values && values.length >= count && values.slice(0, count).every((value) => typeof value === 'number' && Number.isFinite(value)));
}

export class DualTrackPlayback {
  private readonly decoders: VideoDecoder[];
  private readonly queues: VideoFrame[][];
  private readonly indexes: number[];
  private readonly currentFrames: Array<VideoFrame | undefined>;
  private startedAt = 0;
  private clockTime = 0;
  private clockRunning = false;
  private feeding = false;
  private closed = false;
  private seekTargetUs = 0;
  private isPaused = false;
  private pauseAfterSeek = false;
  private generation = 0;
  error?: Error;
  readonly duration: number;
  private readonly seekEnd: number;
  streamSyncMs = 0;

  constructor(private readonly processor: PanoramaProcessor, private readonly tracks: PanoramaVideoTrack[], private readonly textures: Pick<VideoFrameTexture, 'setFrame'>[], private readonly configs: VideoDecoderConfig[], private readonly onPair: (first: VideoFrame, second: VideoFrame) => void, private readonly prepareImu: (seconds: number) => Promise<void>, private readonly onSeek: () => void) {
    this.queues = tracks.map(() => []);
    this.indexes = tracks.map(() => 0);
    this.currentFrames = tracks.map(() => undefined);
    this.duration = Math.min(...tracks.map(panoramaTrackDuration));
    this.seekEnd = Math.min(...tracks.map((track) => track.samples.at(-1)!.pts / track.timescale));
    this.decoders = [];
    try {
      configs.forEach((config, index) => {
        const decoder = new VideoDecoder({
          output: (frame) => {
            if (this.closed) { frame.close(); return; }
            this.queues[index].push(frame);
            try { this.pairFrames(); } catch (error) { this.fail(error); }
          },
          error: (error) => this.fail(error)
        });
        this.decoders.push(decoder);
        decoder.configure(config);
      });
    } catch (error) {
      this.close();
      throw error;
    }
  }

  start() {
    this.startedAt = performance.now();
    this.update();
  }

  update() {
    if (this.closed || this.isPaused) return;
    this.pairFrames();
    if (this.feeding || this.isPaused) return;
    if (this.duration > 0 && this.currentTime >= this.duration) { this.seek(0); return; }
    this.feeding = true;
    const generation = this.generation;
    void this.feed(this.currentTime + (this.clockRunning ? 0.25 : 0), generation)
      .catch((error) => this.fail(error))
      .finally(() => { this.feeding = false; });
  }

  get currentTime(): number {
    return Math.min(this.duration, this.clockTime + (this.isPaused || !this.clockRunning ? 0 : (performance.now() - this.startedAt) / 1000));
  }

  get paused(): boolean { return this.isPaused; }

  play() {
    if (this.closed || !this.isPaused) return;
    this.startedAt = performance.now();
    this.isPaused = false;
    this.update();
  }

  pause() {
    if (this.closed || this.isPaused) return;
    this.clockTime = this.currentTime;
    this.isPaused = true;
  }

  seek(seconds: number) {
    if (this.closed) return;
    const target = Math.max(0, Math.min(Number.isFinite(seconds) ? seconds : 0, this.seekEnd));
    this.pauseAfterSeek = this.isPaused;
    this.isPaused = false;
    this.clockTime = target;
    this.startedAt = performance.now();
    this.clockRunning = false;
    this.seekTargetUs = target * 1_000_000;
    this.generation += 1;
    const indexes = this.processor.seek(target);
    this.tracks.forEach((track, index) => { this.indexes[index] = indexes[track.id] ?? 0; });
    this.queues.flat().forEach((frame) => frame.close());
    this.queues.forEach((_, index) => { this.queues[index] = []; });
    this.currentFrames.forEach((frame, index) => { frame?.close(); this.currentFrames[index] = undefined; });
    this.decoders.forEach((decoder, index) => { decoder.reset(); decoder.configure(this.configs[index]); });
    this.onSeek();
    this.update();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.decoders.forEach((decoder) => { if (decoder.state !== 'closed') decoder.close(); });
    this.queues.flat().forEach((frame) => frame.close());
    this.currentFrames.forEach((frame) => frame?.close());
  }

  private fail(error: unknown) {
    this.error = error instanceof Error ? error : new Error(String(error));
    this.close();
  }

  private async feed(targetSeconds: number, generation: number) {
    await this.prepareImu(targetSeconds);
    if (generation !== this.generation) return;
    const priming = !this.clockRunning;
    for (let trackIndex = 0; trackIndex < this.tracks.length; trackIndex += 1) {
      const track = this.tracks[trackIndex];
      let fed = 0;
      while (this.indexes[trackIndex] < track.samples.length && this.decoders[trackIndex].decodeQueueSize < 4) {
        const sampleIndex = this.indexes[trackIndex];
        const sample = track.samples[sampleIndex];
        if ((!priming && sample.pts / track.timescale > targetSeconds) || (priming && fed > 0)) break;
        const encoded = await this.processor.readSample(track.id, sampleIndex);
        if (this.closed || generation !== this.generation) return;
        this.decoders[trackIndex].decode(panoramaEncodedVideoChunk(encoded));
        this.indexes[trackIndex] += 1;
        fed += 1;
      }
    }
  }

  private pairFrames() {
    if (this.closed || this.isPaused) return;
    if (this.tracks.length === 1) {
      while (this.queues[0].length) {
        if (!this.frameDue(this.queues[0][0])) break;
        const frame = this.queues[0].shift()!;
        if (frame.timestamp < this.seekTargetUs) { frame.close(); continue; }
        this.seekTargetUs = 0;
        this.streamSyncMs = 0;
        this.setFrame(0, frame);
        this.startClock(frame);
        this.onPair(frame, frame);
        this.finishSeek(frame);
      }
      return;
    }
    while (this.queues[0].length && this.queues[1].length) {
      const first = this.queues[0][0];
      const second = this.queues[1][0];
      if (!this.frameDue(first) || !this.frameDue(second)) break;
      const difference = first.timestamp - second.timestamp;
      const halfFrame = Math.max(first.duration || 0, second.duration || 0, 16_667) / 2;
      if (Math.abs(difference) <= halfFrame) {
        this.queues[0].shift();
        this.queues[1].shift();
        if (Math.min(first.timestamp, second.timestamp) < this.seekTargetUs) {
          first.close();
          second.close();
          continue;
        }
        this.seekTargetUs = 0;
        this.streamSyncMs = Math.abs(difference) / 1000;
        this.setFrame(0, first);
        this.setFrame(1, second);
        this.startClock(first);
        this.onPair(first, second);
        this.finishSeek(first);
      } else {
        const older = difference < 0 ? this.queues[0].shift() : this.queues[1].shift();
        older?.close();
      }
    }
  }

  private frameDue(frame: VideoFrame): boolean {
    return !this.clockRunning || frame.timestamp <= this.currentTime * 1_000_000;
  }

  private startClock(frame: VideoFrame) {
    if (this.clockRunning) return;
    this.clockTime = frame.timestamp / 1_000_000;
    this.startedAt = performance.now();
    this.clockRunning = true;
  }

  private finishSeek(frame: VideoFrame) {
    if (!this.pauseAfterSeek) return;
    this.clockTime = frame.timestamp / 1_000_000;
    this.isPaused = true;
    this.pauseAfterSeek = false;
  }

  private setFrame(index: number, frame: VideoFrame) {
    this.currentFrames[index]?.close();
    this.currentFrames[index] = frame;
    this.textures[index]?.setFrame(frame);
  }
}

class ImuStabilizer {
  readonly available: boolean;
  mode: PanoramaStabilizationMode;
  private samples: PanoramaImuSample[] = [];
  private nextIndex = 0;
  private loading = false;
  private generation = 0;

  constructor(private readonly processor: PanoramaProcessor, private readonly manifest: PanoramaAssetManifest, private readonly material: ShaderMaterial) {
    this.available = Boolean(manifest.metadataTrack && manifest.imu?.imuToCameraConfirmed === true);
    this.mode = this.available ? manifest.imu?.stabilizationDefault ?? 'off' : 'off';
  }

  setMode(mode: PanoramaStabilizationMode): PanoramaStabilizationMode {
    this.mode = this.available ? mode : 'off';
    if (this.mode === 'off' || this.mode === 'camera') this.material.uniforms.stabilizationQuaternion.value = [1, 0, 0, 0];
    return this.mode;
  }

  reset(): void {
    this.generation += 1;
    this.samples = [];
    this.nextIndex = 0;
    this.material.uniforms.stabilizationQuaternion.value = [1, 0, 0, 0];
  }

  async prepare(seconds: number): Promise<void> {
    const track = this.manifest.metadataTrack;
    if (!this.available || this.mode !== 'horizon-lock' || !track || this.loading) return;
    const last = this.samples.at(-1);
    if (last && last.pts / last.timescale >= seconds + 0.25) return;
    if (!this.samples.length) this.nextIndex = track.samples.findIndex((sample) => sample.pts / track.timescale >= Math.max(0, seconds - 0.25));
    if (this.nextIndex < 0 || this.nextIndex >= track.samples.length) return;
    let count = 0;
    const end = track.samples[this.nextIndex].pts + track.timescale;
    while (this.nextIndex + count < track.samples.length && count < 120 && track.samples[this.nextIndex + count].pts <= end) count += 1;
    this.loading = true;
    const generation = this.generation;
    try {
      const decoded = await this.processor.readImuWindow(this.nextIndex, count);
      if (generation !== this.generation) return;
      this.samples = [...this.samples.slice(-1), ...decoded];
      this.nextIndex += count;
    } catch {
      // ponytail: metadata is optional for rendering; disable stabilization instead of stopping video.
      this.setMode('off');
    } finally {
      this.loading = false;
    }
  }

  apply(seconds: number): void {
    if (!this.available || this.mode !== 'horizon-lock') return;
    const valid = this.samples.filter((sample) => validQuaternion(sample.cameraRotation));
    if (!valid.length) return;
    let right = valid.findIndex((sample) => sample.pts / sample.timescale >= seconds);
    if (right < 0) right = valid.length - 1;
    const left = Math.max(0, right - 1);
    const a = valid[left];
    const b = valid[right];
    const start = a.pts / a.timescale;
    const duration = b.pts / b.timescale - start;
    const rotation = slerpQuaternion(a.cameraRotation as number[], b.cameraRotation as number[], duration > 0 ? (seconds - start) / duration : 0);
    const yaw = Math.atan2(2 * (rotation[0] * rotation[3] + rotation[1] * rotation[2]), 1 - 2 * (rotation[2] ** 2 + rotation[3] ** 2));
    this.material.uniforms.stabilizationQuaternion.value = multiplyQuaternion(conjugateQuaternion(rotation), [Math.cos(yaw / 2), 0, 0, Math.sin(yaw / 2)]);
  }
}

export function slerpQuaternion(a: number[], b: number[], amount: number): number[] {
  const first = normalizeQuaternion(a);
  let second = normalizeQuaternion(b);
  let dot = first.reduce((sum, value, index) => sum + value * second[index], 0);
  if (dot < 0) { second = second.map((value) => -value); dot = -dot; }
  const t = Math.max(0, Math.min(1, amount));
  if (dot > 0.9995) return normalizeQuaternion(first.map((value, index) => value + t * (second[index] - value)));
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  const scale = Math.sin(angle);
  return first.map((value, index) => (value * Math.sin((1 - t) * angle) + second[index] * Math.sin(t * angle)) / scale);
}

function validQuaternion(value?: Array<number | null> | null): value is number[] {
  return value?.length === 4 && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

function normalizeQuaternion(value: number[]): number[] {
  const length = Math.hypot(...value) || 1;
  return [0, 1, 2, 3].map((index) => Number(value[index] ?? (index === 0 ? 1 : 0)) / length);
}

function conjugateQuaternion(value: number[]): number[] { return [value[0], -value[1], -value[2], -value[3]]; }

function multiplyQuaternion(a: number[], b: number[]): number[] {
  return [
    a[0]*b[0] - a[1]*b[1] - a[2]*b[2] - a[3]*b[3],
    a[0]*b[1] + a[1]*b[0] + a[2]*b[3] - a[3]*b[2],
    a[0]*b[2] - a[1]*b[3] + a[2]*b[0] + a[3]*b[1],
    a[0]*b[3] + a[1]*b[2] - a[2]*b[1] + a[3]*b[0]
  ];
}

const ANALYSIS_WIDTH = 128;
const ANALYSIS_HEIGHT = 64;
const SOURCE_ANALYSIS_SIZE = 256;

class PanoramaFrameAnalyzer {
  private lastAnalysis = -Infinity;
  private busy = false;
  private closed = false;
  private previousLeft?: number[];
  private previousRight?: number[];
  private generation = 0;
  active = false;

  constructor(private readonly processor: PanoramaProcessor, private readonly manifest: PanoramaAssetManifest, private readonly lensSources: [PanoramaLensSource, PanoramaLensSource], private readonly material: ShaderMaterial, private readonly seamTexture: DataTexture) {}

  accept(first: VideoFrame, second: VideoFrame) {
    const now = performance.now();
    if (this.closed || this.busy || now - this.lastAnalysis < 500) return;
    this.lastAnalysis = now;
    this.busy = true;
    const generation = this.generation;
    const frames = [first.clone(), second.clone()];
    void this.analyze(frames, generation).catch(() => {
      // ponytail: keep calibrated blending when optional seam analysis is unavailable.
    }).finally(() => {
      frames.forEach((frame) => frame.close());
      this.busy = false;
    });
  }

  acceptImage(image: CanvasImageSource) {
    if (this.closed || this.busy) return;
    this.busy = true;
    const generation = this.generation;
    void this.analyze([image, image], generation).catch(() => {
      // Static INSP rendering can retain calibrated blending if seam analysis is unavailable.
    }).finally(() => { this.busy = false; });
  }

  close() { this.closed = true; }

  reset() {
    this.generation += 1;
    this.previousLeft = undefined;
    this.previousRight = undefined;
    this.lastAnalysis = -Infinity;
    this.material.uniforms.useDynamicSeam.value = 0;
    this.material.uniforms.exposureGain0.value = [1, 1, 1];
    this.material.uniforms.exposureGain1.value = [1, 1, 1];
    this.active = false;
  }

  private async analyze(frames: CanvasImageSource[], generation: number) {
    const images = frames.map((frame) => framePixels(frame));
    const colors = [new Uint8Array(ANALYSIS_WIDTH * ANALYSIS_HEIGHT * 3), new Uint8Array(ANALYSIS_WIDTH * ANALYSIS_HEIGHT * 3)];
    const weights = [new Float32Array(ANALYSIS_WIDTH * ANALYSIS_HEIGHT), new Float32Array(ANALYSIS_WIDTH * ANALYSIS_HEIGHT)];
    const lenses = this.manifest.lenses.slice(0, 2);
    let overlapCount = 0;
    const channelSums = [new Float64Array(3), new Float64Array(3)];

    for (let y = 0; y < ANALYSIS_HEIGHT; y += 1) {
      for (let x = 0; x < ANALYSIS_WIDTH; x += 1) {
        const direction = panoramaDirection((x + 0.5) / ANALYSIS_WIDTH, (y + 0.5) / ANALYSIS_HEIGHT, this.manifest.projection.kind);
        const index = y * ANALYSIS_WIDTH + x;
        for (let lensIndex = 0; lensIndex < 2; lensIndex += 1) {
          const projected = projectLensCpu(direction, lenses[lensIndex], this.manifest.projection.kind);
          if (!projected) continue;
          const colorIndex = index * 3;
          const pixels = images[lensIndex];
          const sourceUv = panoramaLensSourceUv(projected[0], projected[1], this.lensSources[lensIndex], this.manifest.textureOrigin);
          sampleFrameBilinear(pixels, SOURCE_ANALYSIS_SIZE, sourceUv[0], sourceUv[1], colors[lensIndex], colorIndex);
          weights[lensIndex][index] = projected[2] * (this.manifest.projection.kind === 'mei-extended'
            ? meiLensPreference((x + 0.5) / ANALYSIS_WIDTH, lensIndex)
            : 1);
        }
        if (weights[0][index] > 0 && weights[1][index] > 0) {
          overlapCount += 1;
          const colorIndex = index * 3;
          for (let channel = 0; channel < 3; channel += 1) {
            channelSums[0][channel] += colors[0][colorIndex + channel];
            channelSums[1][channel] += colors[1][colorIndex + channel];
          }
        }
      }
    }

    let exposureGains: [number[], number[]] = [
      this.material.uniforms.exposureGain0.value as number[],
      this.material.uniforms.exposureGain1.value as number[]
    ];
    if (overlapCount > 64) {
      const target = symmetricColorGains(channelSums[0], channelSums[1]);
      exposureGains = this.active
        ? target.map((gains, lens) => gains.map((value, channel) => exposureGains[lens][channel] * 0.8 + value * 0.2)) as [number[], number[]]
        : target;
      this.material.uniforms.exposureGain0.value = exposureGains[0];
      this.material.uniforms.exposureGain1.value = exposureGains[1];
    }
    if (overlapCount <= 64) return;
    const costs = new Uint16Array(ANALYSIS_WIDTH * ANALYSIS_HEIGHT);
    costs.fill(65535);
    for (let y = 0; y < ANALYSIS_HEIGHT; y += 1) {
      for (let x = 0; x < ANALYSIS_WIDTH; x += 1) {
        const index = y * ANALYSIS_WIDTH + x;
        if (weights[0][index] <= 0 || weights[1][index] <= 0) continue;
        const colorIndex = index * 3;
        const colorDifference = Math.abs(colors[0][colorIndex] * exposureGains[0][0] - colors[1][colorIndex] * exposureGains[1][0])
          + Math.abs(colors[0][colorIndex + 1] * exposureGains[0][1] - colors[1][colorIndex + 1] * exposureGains[1][1])
          + Math.abs(colors[0][colorIndex + 2] * exposureGains[0][2] - colors[1][colorIndex + 2] * exposureGains[1][2]);
        const left = x > 0 ? index - 1 : index;
        const top = y > 0 ? index - ANALYSIS_WIDTH : index;
        const gradient0 = correctedGradient(colors[0], exposureGains[0], index, left, top);
        const gradient1 = correctedGradient(colors[1], exposureGains[1], index, left, top);
        costs[index] = Math.min(65534, colorDifference + Math.abs(gradient0 - gradient1) * 2
          + overlapCoveragePenalty(weights[0][index], weights[1][index]));
      }
    }

    const circular = this.manifest.projection.kind === 'dji-fisheye-lut';
    const seamCosts = circular ? rotatePanoramaRows(costs, ANALYSIS_WIDTH, ANALYSIS_HEIGHT, ANALYSIS_WIDTH / 4) : costs;
    const half = ANALYSIS_WIDTH / 2;
    const [left, right] = await Promise.all([
      this.processor.computeSeam({ width: half, height: ANALYSIS_HEIGHT, costs: halfCosts(seamCosts, 0), previous: this.previousLeft, temporalWeight: 3, maxStep: 2 }),
      this.processor.computeSeam({ width: half, height: ANALYSIS_HEIGHT, costs: halfCosts(seamCosts, half), previous: this.previousRight, temporalWeight: 3, maxStep: 2 })
    ]);
    if (this.closed || generation !== this.generation) return;
    // ponytail: a mean-cost gate avoids forcing a hard seam through structures; replace it with a trained scene classifier only if the golden set proves necessary.
    if (!acceptDynamicSeams([left, right], ANALYSIS_HEIGHT)) {
      this.material.uniforms.useDynamicSeam.value = 0;
      this.active = false;
      return;
    }
    const leftSeam = limitTemporalSeam(stabilizePolarSeam(left.seam), this.previousLeft);
    const rightSeam = limitTemporalSeam(stabilizePolarSeam(right.seam), this.previousRight);
    if (!seamHasFullOverlap(seamCosts, leftSeam, 0) || !seamHasFullOverlap(seamCosts, rightSeam, half)) {
      this.material.uniforms.useDynamicSeam.value = 0;
      this.active = false;
      return;
    }
    this.previousLeft = leftSeam;
    this.previousRight = rightSeam;
    const mask = circular
      ? buildCircularSeamMask(
          weights,
          unrotatePanoramaSeam(leftSeam, ANALYSIS_WIDTH, ANALYSIS_WIDTH / 4),
          unrotatePanoramaSeam(rightSeam.map((value) => value + half), ANALYSIS_WIDTH, ANALYSIS_WIDTH / 4)
        )
      : buildSeamMask(weights, leftSeam, rightSeam.map((value) => value + half));
    (this.seamTexture.image.data as Uint8Array).set(mask);
    this.seamTexture.needsUpdate = true;
    this.material.uniforms.useDynamicSeam.value = 1;
    this.active = true;
  }
}

export function symmetricExposureGains(first: number, second: number): [number, number] {
  if (!(first > 0) || !(second > 0)) return [1, 1];
  const gain = Math.sqrt(Math.max(0.64, Math.min(1.5625, second / first)));
  return [gain, 1 / gain];
}

export function supportsDynamicPanoramaSeam(projection: PanoramaAssetManifest['projection']['kind']): boolean {
  return projection === 'mei-extended' || projection === 'dji-fisheye-lut';
}

export function acceptDynamicSeams(seams: Array<{ cost: number }>, height: number, maxMeanCost = 120): boolean {
  return height > 0 && seams.length > 0 && seams.every((seam) => Number.isFinite(seam.cost) && seam.cost / height <= maxMeanCost);
}

export function symmetricColorGains(first: ArrayLike<number>, second: ArrayLike<number>): [number[], number[]] {
  const pairs = [0, 1, 2].map((channel) => symmetricExposureGains(Number(first[channel]), Number(second[channel])));
  return [pairs.map((pair) => pair[0]), pairs.map((pair) => pair[1])];
}

export function overlapCoveragePenalty(first: number, second: number): number {
  const total = first + second;
  if (!(first > 0) || !(second > 0) || !(total > 0)) return 128;
  return Math.round((1 - 2 * Math.min(first, second) / total) * 128);
}

export function stabilizePolarSeam(seam: number[], margin = 2): number[] {
  if (margin <= 0 || seam.length <= margin * 2) return seam.slice();
  const stable = seam.slice();
  stable.fill(seam[margin], 0, margin);
  stable.fill(seam[seam.length - margin - 1], seam.length - margin);
  return stable;
}

export function limitTemporalSeam(seam: number[], previous?: number[], maxDelta = 4): number[] {
  if (!previous || previous.length !== seam.length || maxDelta < 0) return seam.slice();
  return seam.map((value, index) => Math.max(previous[index] - maxDelta, Math.min(previous[index] + maxDelta, value)));
}

export function seamHasFullOverlap(costs: Uint16Array, seam: number[], offset = 0, width = ANALYSIS_WIDTH): boolean {
  return seam.length > 0 && seam.every((x, y) => x >= 0 && offset + x < width && costs[y * width + offset + x] < 65535);
}

function correctedGradient(colors: Uint8Array, gains: number[], index: number, left: number, top: number): number {
  const center = correctedLuminance(colors, gains, index);
  return Math.abs(center - correctedLuminance(colors, gains, left)) + Math.abs(center - correctedLuminance(colors, gains, top));
}

function correctedLuminance(colors: Uint8Array, gains: number[], index: number): number {
  const offset = index * 3;
  return (colors[offset] * gains[0] * 77 + colors[offset + 1] * gains[1] * 150 + colors[offset + 2] * gains[2] * 29) / 256;
}

export type Vec3 = [number, number, number];

function framePixels(frame: CanvasImageSource): Uint8ClampedArray {
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(SOURCE_ANALYSIS_SIZE, SOURCE_ANALYSIS_SIZE)
    : Object.assign(document.createElement('canvas'), { width: SOURCE_ANALYSIS_SIZE, height: SOURCE_ANALYSIS_SIZE });
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('A 2D canvas is required for panorama seam analysis.');
  context.drawImage(frame, 0, 0, SOURCE_ANALYSIS_SIZE, SOURCE_ANALYSIS_SIZE);
  return context.getImageData(0, 0, SOURCE_ANALYSIS_SIZE, SOURCE_ANALYSIS_SIZE).data;
}

export function sampleFrameBilinear(pixels: Uint8ClampedArray, size: number, u: number, v: number, output = new Uint8Array(3), offset = 0): Uint8Array {
  const x = Math.max(0, Math.min(size - 1, u * size - 0.5));
  const y = Math.max(0, Math.min(size - 1, v * size - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(size - 1, x0 + 1), y1 = Math.min(size - 1, y0 + 1);
  const tx = x - x0, ty = y - y0;
  for (let channel = 0; channel < 3; channel += 1) {
    const top = pixels[(y0 * size + x0) * 4 + channel] * (1 - tx) + pixels[(y0 * size + x1) * 4 + channel] * tx;
    const bottom = pixels[(y1 * size + x0) * 4 + channel] * (1 - tx) + pixels[(y1 * size + x1) * 4 + channel] * tx;
    output[offset + channel] = Math.round(top * (1 - ty) + bottom * ty);
  }
  return output;
}

export function panoramaTextureFlipY(origin: PanoramaAssetManifest['textureOrigin']): boolean {
  return origin !== 'top-left';
}

export function panoramaFrameSampleV(v: number, origin: PanoramaAssetManifest['textureOrigin']): number {
  return origin === 'top-left' ? v : 1 - v;
}

export function projectLensCpu(body: Vec3, lens: PanoramaLens, projection: PanoramaAssetManifest['projection']['kind']): [number, number, number] | undefined {
  const quaternion = lensQuaternion(lens);
  const direction = rotateCpu(projection === 'mei-extended' ? conjugateQuaternion(quaternion) : quaternion, body);
  const theta = Math.acos(Math.max(-1, Math.min(1, direction[2])));
  let pixelX: number;
  let pixelY: number;
  if (projection === 'mei-extended') {
    const denominator = direction[2] + (lens.xi || 0);
    if (denominator <= 1e-6) return undefined;
    const x = direction[0] / denominator;
    const y = direction[1] / denominator;
    const r2 = x*x + y*y;
    if (!Number.isFinite(r2) || r2 > 16) return undefined;
    const r4 = r2*r2;
    const radial = lensDistortion(lens);
    const tangential = lensPair(lens.tangential);
    const thin = lensFour(lens.thinPrism);
    const factor = 1 + radial[0]*r2 + radial[1]*r4 + radial[2]*r2*r4 + radial[3]*r4*r4;
    const xd = x*factor + 2*tangential[0]*x*y + tangential[1]*(r2 + 2*x*x) + thin[0]*r2 + thin[1]*r4;
    const yd = y*factor + tangential[0]*(r2 + 2*y*y) + 2*tangential[1]*x*y + thin[2]*r2 + thin[3]*r4;
    const tilted = lens.distortionModel === 'radtan_pro'
      ? applyRadtanPro([x, y], lens.distortionCoeffs!)
      : applySensorTilt([xd, yd], lensPair(lens.sensorTilt));
    pixelX = (lens.cx || 0) + (lens.fx || 1) * tilted[0];
    pixelY = (lens.cy || 0) + (lens.fy || lens.fx || 1) * tilted[1];
  } else {
    if (theta >= 96 * Math.PI / 180) return undefined;
    const rho = Math.max(1e-6, Math.hypot(direction[0], direction[1]));
    const radius = djiRadius(theta, lens);
    pixelX = (lens.cx || 0) + radius * direction[0] / rho;
    pixelY = (lens.cy || 0) + radius * direction[1] / rho;
  }
  const width = lens.width || 1;
  const height = lens.height || 1;
  if (!Number.isFinite(pixelX) || !Number.isFinite(pixelY)) return undefined;
  if (pixelX < 0 || pixelX > width - 1 || pixelY < 0 || pixelY > height - 1) return undefined;
  const u = (pixelX + 0.5) / width;
  const v = (pixelY + 0.5) / height;
  const edgeDepth = 0.475 * Math.min(width, height) - Math.hypot(pixelX - (lens.cx || 0), pixelY - (lens.cy || 0));
  if (projection === 'mei-extended' && edgeDepth <= 0) return undefined;
  return [u, v, projection === 'mei-extended' ? edgeDepth : djiOverlapWeight(theta)];
}

/** X5 offset_v6 stores RadtanPro coefficients, not OpenCV sensor tilt. */
export function applyRadtanPro([x, y]: [number, number], k: number[]): [number, number] {
  const r2 = x*x + y*y;
  const r4 = r2*r2;
  const radial = 1 + k[0]*r2 + k[1]*r4 + k[2]*r2*r4 + k[3]*r4*r4 + k[4]*r4*r4*r2;
  const a = k[5] + k[7]*r2;
  const b = k[6] + k[8]*r2;
  return [
    x*radial + (r2 + 2*x*x)*a + 2*x*y*b + k[9]*r2 + k[11]*r4,
    y*radial + (r2 + 2*y*y)*b + 2*x*y*a + k[10]*r2 + k[12]*r4
  ];
}

// Keep the retained image, IMU and HTML-media paths on the same X5 model as
// the Photos renderer. Generic MEI calibration continues to use sensor tilt.
function applyVendorDistortion(material: ShaderMaterial, lenses: PanoramaLens[]): void {
  if (!lenses.some((lens) => lens.distortionModel === 'radtan_pro')) return;
  const declarations = lenses.slice(0, 2).map((lens, index) => {
    const k = Array.from({ length: 13 }, (_, offset) => lens.distortionCoeffs?.[offset] ?? 0);
    for (let block = 0; block < 3; block += 1) material.uniforms[`pro${index}_${block}`] = { value: k.slice(block * 4, block * 4 + 4) };
    material.uniforms[`pro${index}_last`] = { value: k[12] };
    material.uniforms[`usePro${index}`] = { value: lens.distortionModel === 'radtan_pro' ? 1 : 0 };
    return `uniform vec4 pro${index}_0, pro${index}_1, pro${index}_2;
      uniform float pro${index}_last;
      uniform int usePro${index};`;
  }).join('\n');
  const helper = `${declarations}
    vec2 radtanPro(vec2 p, vec4 a, vec4 b, vec4 c, float last) {
      float r2 = dot(p, p), r4 = r2*r2;
      float radial = 1.0+a.x*r2+a.y*r4+a.z*r2*r4+a.w*r4*r4+b.x*r4*r4*r2;
      float u = b.y+b.w*r2, v = b.z+c.x*r2;
      return vec2(p.x*radial+(r2+2.0*p.x*p.x)*u+2.0*p.x*p.y*v+c.y*r2+c.w*r4,
        p.y*radial+(r2+2.0*p.y*p.y)*v+2.0*p.x*p.y*u+c.z*r2+last*r4);
    }
    vec2 calibratedDistortion(vec2 point, vec2 fallback, int lensIndex) {
      if (lensIndex == 0 && usePro0 == 1) return radtanPro(point, pro0_0, pro0_1, pro0_2, pro0_last);
      if (lensIndex == 1 && usePro1 == 1) return radtanPro(point, pro1_0, pro1_1, pro1_2, pro1_last);
      return fallback;
    }
  `;
  material.fragmentShader = material.fragmentShader
    .replace('precision highp float;', `precision highp float;\n${helper}`)
    .replace('sampler2D image) {', 'sampler2D image, int lensIndex) {')
    .replace('intrinsics.xy * applySensorTilt(distorted, sensorTilt)', 'intrinsics.xy * calibratedDistortion(normalized, applySensorTilt(distorted, sensorTilt), lensIndex)')
    .replace('sensorTilt0, lens0);', 'sensorTilt0, lens0, 0);')
    .replace('sensorTilt1, lens1);', 'sensorTilt1, lens1, 1);');
}

export function djiOverlapWeight(theta: number): number {
  return Math.max(0, Math.min(1, (95 * Math.PI / 180 - theta) / (10 * Math.PI / 180)));
}

export function panoramaDirection(u: number, v: number, projection: PanoramaAssetManifest['projection']['kind']): Vec3 {
  const longitude = u * Math.PI * 2 - Math.PI;
  const latitude = (v - 0.5) * Math.PI;
  const cosLatitude = Math.cos(latitude);
  return projection === 'mei-extended'
    ? [cosLatitude * Math.sin(longitude), -Math.sin(latitude), cosLatitude * Math.cos(longitude)]
    : [cosLatitude * Math.sin(longitude + Math.PI / 2), cosLatitude * Math.cos(longitude + Math.PI / 2), Math.sin(latitude)];
}

export function panoramaUvFromDirection(direction: Vec3, projection: PanoramaAssetManifest['projection']['kind']): [number, number] {
  const longitude = projection === 'mei-extended'
    ? Math.atan2(direction[0], direction[2])
    : Math.atan2(-direction[1], direction[0]);
  const latitude = Math.asin(Math.max(-1, Math.min(1, projection === 'mei-extended' ? -direction[1] : direction[2])));
  return [(longitude / (Math.PI * 2) + 1.5) % 1, latitude / Math.PI + 0.5];
}

export function meiLensPreference(u: number, lensIndex: number): number {
  const longitude = u * 360 - 180;
  const front = 1 - smoothstep(75, 105, Math.abs(longitude));
  return lensIndex === 0 ? front : 1 - front;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t*t*(3 - 2*t);
}

export function applySensorTilt(point: [number, number], tilt: number[]): [number, number] {
  const [x, y] = point;
  const [tauX, tauY] = tilt;
  const cX = Math.cos(tauX), sX = Math.sin(tauX);
  const cY = Math.cos(tauY), sY = Math.sin(tauY);
  const rotatedX = cY*x + sY*sX*y - sY*cX;
  const rotatedY = cX*y + sX;
  const rotatedZ = sY*x - cY*sX*y + cY*cX;
  const safeRotatedZ = Math.abs(rotatedZ) > 1e-6 ? rotatedZ : (rotatedZ < 0 ? -1e-6 : 1e-6);
  const scale = 1 / safeRotatedZ;
  return [cX*(cY*rotatedX + sY*rotatedZ)*scale, (cY*cX*rotatedY - sX*rotatedZ)*scale];
}

function rotateCpu(quaternion: number[], vector: Vec3): Vec3 {
  const length = Math.hypot(...quaternion) || 1;
  const [w, x, y, z] = quaternion.map((value) => value / length);
  const dot = x*vector[0] + y*vector[1] + z*vector[2];
  const cross: Vec3 = [y*vector[2] - z*vector[1], z*vector[0] - x*vector[2], x*vector[1] - y*vector[0]];
  const scalar = w*w - x*x - y*y - z*z;
  return [
    2*dot*x + scalar*vector[0] + 2*w*cross[0],
    2*dot*y + scalar*vector[1] + 2*w*cross[1],
    2*dot*z + scalar*vector[2] + 2*w*cross[2]
  ];
}

function djiRadius(theta: number, lens: PanoramaLens): number {
  const limit = 85 * Math.PI / 180;
  const t = Math.min(theta, limit);
  const k = lensDistortion(lens);
  const polynomial = t + k[0]*t**3 + k[1]*t**5 + k[2]*t**7 + k[3]*t**9;
  const derivative = 1 + 3*k[0]*t**2 + 5*k[1]*t**4 + 7*k[2]*t**6 + 9*k[3]*t**8;
  return radialScale(lens) * (lens.fx || 1) * (theta > limit ? polynomial + derivative*(theta-limit) : polynomial);
}

function halfCosts(costs: Uint16Array, offset: number): Uint16Array {
  const half = ANALYSIS_WIDTH / 2;
  const result = new Uint16Array(half * ANALYSIS_HEIGHT);
  for (let y = 0; y < ANALYSIS_HEIGHT; y += 1) result.set(costs.subarray(y*ANALYSIS_WIDTH + offset, y*ANALYSIS_WIDTH + offset + half), y*half);
  return result;
}

export function buildSeamMask(weights: Float32Array[], left: number[], right: number[]): Uint8Array {
  const hard = new Uint8Array(ANALYSIS_WIDTH * ANALYSIS_HEIGHT);
  for (let y = 0; y < ANALYSIS_HEIGHT; y += 1) {
    let useSecond = weights[1][y*ANALYSIS_WIDTH] > weights[0][y*ANALYSIS_WIDTH];
    for (let x = 0; x < ANALYSIS_WIDTH; x += 1) {
      if (x === left[y] || x === right[y]) useSecond = !useSecond;
      hard[y*ANALYSIS_WIDTH + x] = useSecond ? 255 : 0;
    }
  }
  return featherBinarySeams(hard, false);
}

export function buildCircularSeamMask(weights: Float32Array[], first: number[], second: number[]): Uint8Array {
  const hard = new Uint8Array(ANALYSIS_WIDTH * ANALYSIS_HEIGHT);
  const anchor = ANALYSIS_WIDTH / 4;
  const polarMargin = ANALYSIS_HEIGHT / 8;
  for (let y = 0; y < ANALYSIS_HEIGHT; y += 1) {
    if (y < polarMargin || y >= ANALYSIS_HEIGHT - polarMargin) {
      for (let x = 0; x < ANALYSIS_WIDTH; x += 1) {
        const index = y*ANALYSIS_WIDTH + x;
        const total = weights[0][index] + weights[1][index];
        hard[index] = total > 0 ? Math.round(255 * weights[1][index] / total) : 128;
      }
      continue;
    }
    const low = Math.min(first[y], second[y]);
    const high = Math.max(first[y], second[y]);
    const anchorBetween = anchor >= low && anchor < high;
    const anchorUsesSecond = weights[1][y*ANALYSIS_WIDTH + anchor] > weights[0][y*ANALYSIS_WIDTH + anchor];
    for (let x = 0; x < ANALYSIS_WIDTH; x += 1) {
      const sameArc = (x >= low && x < high) === anchorBetween;
      hard[y*ANALYSIS_WIDTH + x] = (sameArc ? anchorUsesSecond : !anchorUsesSecond) ? 255 : 0;
    }
  }
  return featherBinarySeams(hard, true);
}

export function featherBinarySeams(mask: Uint8Array, circular: boolean): Uint8Array {
  const feathered = mask.slice();
  for (let y = 0; y < ANALYSIS_HEIGHT; y += 1) {
    for (let x = 0; x < ANALYSIS_WIDTH; x += 1) {
      const index = y*ANALYSIS_WIDTH + x;
      const value = mask[index];
      if (value !== 0 && value !== 255) continue;
      const leftX = x > 0 ? x - 1 : (circular ? ANALYSIS_WIDTH - 1 : x);
      const rightX = x + 1 < ANALYSIS_WIDTH ? x + 1 : (circular ? 0 : x);
      const crossesSeam = mask[y*ANALYSIS_WIDTH + leftX] === 255 - value
        || mask[y*ANALYSIS_WIDTH + rightX] === 255 - value;
      if (crossesSeam) feathered[index] = value === 0 ? 64 : 191;
    }
  }
  return feathered;
}

export function rotatePanoramaRows(values: Uint16Array, width: number, height: number, shift: number): Uint16Array {
  const rotated = new Uint16Array(values.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) rotated[y*width + (x + shift) % width] = values[y*width + x];
  }
  return rotated;
}

export function unrotatePanoramaSeam(seam: number[], width: number, shift: number): number[] {
  return seam.map((x) => (x - shift + width) % width);
}

function lensIntrinsics(lens: PanoramaLens): number[] {
  return [lens.fx || 1, lens.fy || lens.fx || 1, lens.cx || 0, lens.cy || 0];
}

function lensDistortion(lens: PanoramaLens): number[] {
  const values = lens.radial ?? lens.distortion;
  return [0, 1, 2, 3].map((index) => Number(values?.[index] ?? 0));
}

function lensPair(values?: number[]): number[] { return [Number(values?.[0] ?? 0), Number(values?.[1] ?? 0)]; }
function lensFour(values?: number[]): number[] { return [0, 1, 2, 3].map((index) => Number(values?.[index] ?? 0)); }

function lensQuaternion(lens: PanoramaLens): number[] {
  const q = lens.extrinsicQuaternion;
  return q?.length === 4 && q.every(Number.isFinite) ? q : [1, 0, 0, 0];
}

export function panoramaTrackDuration(track: PanoramaVideoTrack): number {
  const last = track.samples.at(-1);
  return last && track.timescale > 0 ? (last.pts + last.duration) / track.timescale : 0;
}

function radialScale(lens: PanoramaLens): number {
  const a = lens.radialLut1;
  const b = lens.radialLut2;
  if (!a || !b || a.length < 14 || b.length < 14 || !lens.fx) return 1;
  let radius = 0;
  for (let index = 1; index < 14; index += 1) radius += Math.hypot(a[index] - (lens.cx || 0), b[index] - (lens.cy || 0));
  radius /= 13;
  const theta = Math.PI / 2;
  const limit = 85 * Math.PI / 180;
  const k = lensDistortion(lens);
  const polynomial = (value: number) => value + k[0]*value**3 + k[1]*value**5 + k[2]*value**7 + k[3]*value**9;
  const derivative = 1 + 3*k[0]*limit**2 + 5*k[1]*limit**4 + 7*k[2]*limit**6 + 9*k[3]*limit**8;
  const r90 = lens.fx * (polynomial(limit) + derivative * (theta - limit));
  return r90 > 0 ? radius / r90 : 1;
}
