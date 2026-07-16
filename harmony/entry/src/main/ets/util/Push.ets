import { pushService } from '@kit.PushKit';
import { BusinessError } from '@kit.BasicServicesKit';

// Best-effort Push Kit token fetch. Requires the app to be registered in
// AppGallery Connect with Push enabled (App ID/Secret wired into the backend).
// Any failure is swallowed — push is optional and never blocks the flow.
export class Push {
  static async token(): Promise<string> {
    try {
      const t: string = await pushService.getToken();
      return t ? t : '';
    } catch (e) {
      const err: BusinessError = e as BusinessError;
      return '';
    }
  }
}
