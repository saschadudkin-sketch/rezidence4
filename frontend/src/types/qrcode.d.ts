declare module 'qrcode' {
  export type QRCodeColor = {
    dark?: string;
    light?: string;
  };

  export type QRCodeOptions = {
    width?: number;
    margin?: number;
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
    color?: QRCodeColor;
  };

  export type QRCodeModule = {
    toDataURL: (text: string, options?: QRCodeOptions) => Promise<string>;
  };

  const QRCode: QRCodeModule;
  export default QRCode;
}
