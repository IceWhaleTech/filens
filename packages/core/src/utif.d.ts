declare module 'utif' {
  export interface TiffIfd {
    width?: number;
    height?: number;
    data?: Uint8Array;
  }

  export interface UtifModule {
    decode(buffer: ArrayBuffer): TiffIfd[];
    decodeImage(buffer: ArrayBuffer, ifd: TiffIfd, ifds?: TiffIfd[]): void;
    toRGBA8(ifd: TiffIfd): Uint8Array;
  }

  const UTIF: UtifModule;

  export default UTIF;
}
