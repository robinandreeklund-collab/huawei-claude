import { util } from '@kit.ArkTS';
import { image } from '@kit.ImageKit';

// Decode a backend `data:image/png;base64,...` URL into a PixelMap for <Image>.
export class Qr {
  static async decode(dataUrl: string): Promise<image.PixelMap | null> {
    if (!dataUrl || dataUrl.length === 0) {
      return null;
    }
    const comma: number = dataUrl.indexOf(',');
    if (comma < 0) {
      return null;
    }
    const b64: string = dataUrl.substring(comma + 1);
    try {
      const helper: util.Base64Helper = new util.Base64Helper();
      const bytes: Uint8Array = helper.decodeSync(b64);
      const source: image.ImageSource = image.createImageSource(bytes.buffer);
      const pm: image.PixelMap = await source.createPixelMap();
      return pm;
    } catch (e) {
      return null;
    }
  }
}
